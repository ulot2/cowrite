import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { startApp, until } from './harness.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ALARM = 3800 // the object writes to D1 and saves versions three seconds after an edit

// The editor keeps blocks in this fragment. One paragraph, the way BlockNote stores it.
const addParagraph = (tab, text) => {
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText(text)])
  tab.doc.getXmlFragment('document-store').push([p])
}
const textOf = (tab) => tab.doc.getXmlFragment('document-store').toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const page = async (app, id, cookie, query = '') => (await fetch(`${app.base}/doc/${id}/history${query}`, { headers: { cookie } })).text()

let app, ada, bea, docId
before(async () => {
  app = await startApp()
  ada = await app.signUp('Ada')
  bea = await app.signUpUser('Bea')
  docId = await app.createDocument(ada, 'Versioned')
})
after(() => app.stop())

test('the first edit gets an automatic version; a named version, a restore, and a diff work end to end', async () => {
  const a = app.openTab(docId, ada)
  await until(() => a.provider.synced, 'a synced')
  addParagraph(a, 'one')
  await sleep(ALARM)
  let html = await page(app, docId, ada)
  assert.match(html, /Automatic/)
  assert.match(html, /1 version/)

  // Name the state "one", then change the text.
  const saved = await app.post(`/doc/${docId}/history`, ada, { intent: 'save', name: 'Draft one' })
  assert.equal(saved.status, 302)
  const v1 = Number(saved.headers.get('location').split('v=')[1])
  addParagraph(a, 'two')
  await until(() => textOf(a) === 'one two', 'a has both paragraphs')

  // Preview shows the block text; the diff against the live document marks "two" as added.
  html = await page(app, docId, ada, `?v=${v1}`)
  assert.match(html, /class="read-view"><p><span>one<\/span><\/p><\/div>/) // only "one": "two" came after the version
  html = await page(app, docId, ada, `?v=${v1}&against=now`)
  assert.match(html, /data-kind="added"[^]*?two/)
  assert.match(html, /1 block changed/)

  // Restore "Draft one": the open tab changes without a reload, and the state before the restore is kept.
  const restored = await app.post(`/doc/${docId}/history`, ada, { intent: 'restore', id: String(v1) })
  assert.equal(restored.status, 302)
  await until(() => textOf(a) === 'one', 'a is back to one')
  html = await page(app, docId, ada)
  assert.match(html, /3 versions/) // automatic, Draft one, automatic before the restore
  assert.match(html, /restored the version “Draft one”/)
  a.close()
})

test('a viewer can read the history but cannot save or restore', async () => {
  assert.equal((await app.post(`/doc/${docId}`, ada, { intent: 'add', email: bea.email, role: 'viewer' })).status, 200)
  assert.match(await page(app, docId, bea.cookie), /Draft one/)
  assert.equal((await app.post(`/doc/${docId}/history`, bea.cookie, { intent: 'save', name: 'Nope' })).status, 403)
  assert.equal((await app.post(`/doc/${docId}/history`, bea.cookie, { intent: 'restore', id: '1' })).status, 403)
})

test('activity: a rename and an edit show up, and the space timeline lists them', async () => {
  const space = await app.post('/?index', ada, { intent: 'new-space', name: 'Team' })
  const spaceId = space.headers.get('location').split('/').pop()
  const id = await app.createDocument(ada, 'Notes')
  await app.post(`/doc/${id}`, ada, { intent: 'move', space_id: spaceId })
  await app.post(`/doc/${id}`, ada, { intent: 'rename', title: 'Meeting notes' })
  const a = app.openTab(id, ada)
  await until(() => a.provider.synced, 'a synced')
  addParagraph(a, 'agenda')
  await sleep(ALARM)
  a.close()

  const spacePage = await (await fetch(`${app.base}/space/${spaceId}`, { headers: { cookie: ada } })).text()
  assert.match(spacePage, /renamed “Notes” to “Meeting notes”/)
  assert.match(spacePage, /edited the text/)
  assert.match(spacePage, /created the space “Team”/)
  const history = await page(app, id, ada)
  assert.match(history, /<strong>Ada<\/strong>.{0,12}edited the text/) // React puts a marker between text nodes
})

test('deleting a document closes its sockets and wipes its object', async () => {
  const id = await app.createDocument(ada, 'Gone')
  const a = app.openTab(id, ada)
  await until(() => a.provider.synced, 'a synced')
  addParagraph(a, 'bye')
  await sleep(ALARM)
  const del = await app.post('/documents', ada, { intent: 'delete', id })
  assert.equal(del.status, 200)
  // The object closed the socket when it wiped; the provider stops reconnecting only when told.
  await until(() => !a.provider.wsconnected, 'a was closed by the server')
  a.close()
  assert.equal(await app.handshakeStatus(id, ada), 403)
})
