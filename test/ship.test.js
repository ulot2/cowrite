import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { startApp, until } from './harness.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ALARM = 3800 // the object writes the preview, versions, and the search index three seconds after an edit

// A block the way the editor stores it: a content node with attributes and text, marks as formatting.
const add = (tab, type, text, attrs = {}, marks) => {
  const el = new Y.XmlElement(type)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  const t = new Y.XmlText()
  el.insert(0, [t])
  tab.doc.getXmlFragment('document-store').push([el])
  t.insert(0, text, marks)
}

let app, ada, bea, cy, docId
before(async () => {
  app = await startApp()
  ada = await app.signUpUser('Ada')
  bea = await app.signUpUser('Bea')
  cy = await app.signUpUser('Cy')
  docId = await app.createDocument(ada.cookie, 'Launch plan')
  await app.post(`/doc/${docId}`, ada.cookie, { intent: 'add', email: bea.email, role: 'editor' })
  const tab = app.openTab(docId, ada.cookie)
  await until(() => tab.provider.synced, 'synced')
  add(tab, 'heading', 'Why', { level: 1 })
  add(tab, 'paragraph', 'Ship the brief by Friday.')
  add(tab, 'paragraph', 'Note: say thanks to the team')
  add(tab, 'heading', 'How', { level: 1 })
  add(tab, 'bulletListItem', 'Write the draft')
  add(tab, 'paragraph', 'Read the guide', {}, { link: { href: 'https://example.com/guide' } })
  add(tab, 'paragraph', 'bad link', {}, { link: { href: 'javascript:alert(1)' } })
  await sleep(ALARM)
  tab.close()
})
after(() => app.stop())

const get = (path, cookie) => fetch(app.base + path, { headers: cookie ? { cookie } : {}, redirect: 'manual' })

test('publishing makes a public page that shows the published text until it is updated', async () => {
  assert.equal((await app.post(`/doc/${docId}`, bea.cookie, { intent: 'publish' })).status, 403, 'only the owner publishes')
  assert.equal((await app.post(`/doc/${docId}`, ada.cookie, { intent: 'publish' })).status, 200)
  const html = await (await get(`/doc/${docId}`, ada.cookie)).text()
  const slug = html.match(/\/p\/([a-z0-9-]+)/)?.[1] ?? html.match(/"published_slug":"([^"]+)"/)?.[1]
  assert.ok(slug, 'the document page knows its public address')

  let page = await get(`/p/${slug}`)
  assert.equal(page.status, 200, 'no account needed')
  let body = await page.text()
  assert.match(body, /Ship the brief by Friday/)
  assert.match(body, /href="https:\/\/example.com\/guide"/)
  assert.doesNotMatch(body, /javascript:alert/, 'unsafe links are dropped')

  // An edit after publishing stays private until the owner updates the page.
  const tab = app.openTab(docId, ada.cookie)
  await until(() => tab.provider.synced, 'synced')
  add(tab, 'paragraph', 'A private draft line')
  await sleep(300)
  tab.close()
  assert.doesNotMatch(await (await get(`/p/${slug}`)).text(), /private draft line/)
  await app.post(`/doc/${docId}`, ada.cookie, { intent: 'publish' })
  assert.match(await (await get(`/p/${slug}`)).text(), /private draft line/)

  await app.post(`/doc/${docId}`, ada.cookie, { intent: 'unpublish' })
  assert.equal((await get(`/p/${slug}`)).status, 404)
})

test('export gives Markdown, text, and a Word file; a stranger gets 404', async () => {
  const md = await get(`/doc/${docId}/export?format=md`, bea.cookie)
  assert.equal(md.status, 200)
  assert.match(md.headers.get('content-disposition'), /Launch plan\.md/)
  const text = await md.text()
  assert.match(text, /^# Launch plan/)
  assert.match(text, /^# Why$/m)
  assert.match(text, /^- Write the draft$/m)
  assert.match(text, /\[Read the guide\]\(https:\/\/example.com\/guide\)/)

  const txt = await (await get(`/doc/${docId}/export?format=txt`, bea.cookie)).text()
  assert.match(txt, /Ship the brief by Friday\./)
  assert.doesNotMatch(txt, /[#*[\]]/, 'no markup in plain text')

  const docx = new Uint8Array(await (await get(`/doc/${docId}/export?format=docx`, bea.cookie)).arrayBuffer())
  assert.equal(String.fromCharCode(docx[0], docx[1]), 'PK', 'a Word file is a zip')

  assert.equal((await get(`/doc/${docId}/export?format=md`, cy.cookie)).status, 404)
  assert.equal((await get(`/doc/${docId}/print`, cy.cookie)).status, 404)
})

test('search finds a word from the text and from a comment, only for people who can open the document', async () => {
  const hits = async (q, cookie) => (await (await get(`/documents?q=${encodeURIComponent(q)}`, cookie)).text())
  assert.match(await hits('frida', bea.cookie), /Launch plan/, 'a prefix of a body word')
  assert.match(await hits('frida', bea.cookie), /<mark>Friday<\/mark>/)

  const { YjsThreadStore } = await import('@blocknote/core/yjs')
  const { DefaultThreadStoreAuth } = await import('@blocknote/core/comments')
  const beaId = (await (await get('/api/auth/get-session', bea.cookie)).json()).user.id
  const tab = app.openTab(docId, bea.cookie, 'threads')
  await until(() => tab.provider.synced, 'threads synced')
  const store = new YjsThreadStore(beaId, tab.doc.getMap('threads'), new DefaultThreadStoreAuth(beaId, 'editor'))
  await store.createThread({ initialComment: { body: [{ type: 'paragraph', content: [{ type: 'text', text: 'Check the zeppelin numbers', styles: {} }] }] } })
  await sleep(ALARM)
  tab.close()
  const found = await hits('zeppelin', ada.cookie)
  assert.match(found, /Launch plan/)
  assert.match(found, /In a comment/)

  assert.doesNotMatch(await hits('friday', cy.cookie), /Launch plan/, 'a stranger finds nothing')
  assert.match(await hits('"; DROP', ada.cookie), /No document matches/, 'odd input is just words')
})

test('present splits the document at level-1 headings and keeps notes off the slide', async () => {
  const html = await (await get(`/doc/${docId}/present`, bea.cookie)).text()
  assert.match(html, /aria-label="Slide 1 of 2"/)
  const slide = html.match(/<section class="slide[^]*?<\/section>/)[0]
  assert.match(slide, /Ship the brief/)
  assert.doesNotMatch(slide, /say thanks to the team/, 'notes stay off the slide')
})
