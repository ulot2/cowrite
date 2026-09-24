import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { startApp, until } from './harness.js'

// The harness starts the app with AI_FAKE: "propose" answers a fixed JSON (a task for Bea, dated
// 2031-05-04, and "Launch in November"), and "check" reports D-1 whenever the text is not empty.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ALARM = 3800

let app, ada, bea, cy, dee, eve, beaId, spaceId, docId
before(async () => {
  app = await startApp()
  ;[ada, bea, cy, dee, eve] = await Promise.all(['Ada', 'Bea', 'Cy', 'Dee', 'Eve'].map((n) => app.signUpUser(n)))
  beaId = (await (await fetch(`${app.base}/api/auth/get-session`, { headers: { cookie: bea.cookie } })).json()).user.id
  spaceId = (await app.post('/?index', ada.cookie, { intent: 'new-space', name: 'Launch' })).headers.get('location').split('/').pop()
  await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'add', email: bea.email, role: 'editor' })
  await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'add', email: cy.email, role: 'viewer' })
  await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'add', email: eve.email, role: 'commenter' })
  await app.post('/settings', eve.cookie, { intent: 'nib' }) // an unchecked switch: Nib off

  // A document, a discussion, and an answered question (D-1) in the space.
  docId = (await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'create', mode: 'write' })).headers.get('location').split('/').pop()
  await app.post(`/doc/${docId}`, ada.cookie, { intent: 'rename', title: 'Webinar plan' })
  const text = app.openTab(docId, ada.cookie)
  await until(() => text.provider.synced, 'doc synced')
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText('The partner webinar runs in October, right after launch.')])
  text.doc.getXmlFragment('document-store').push([p])

  const room = app.openTab(`space/${spaceId}`, ada.cookie)
  await until(() => room.provider.synced, 'room synced')
  const talk = (id, fields, said) => {
    const d = new Y.Map(), posts = new Y.Array(), m = new Y.Map()
    room.doc.transact(() => {
      room.doc.getMap('discussions').set(id, d)
      for (const [k, v] of Object.entries({ kind: 'talk', status: 'open', createdBy: 'x', createdAt: Date.now(), ...fields })) d.set(k, v)
      d.set('posts', posts)
      m.set('id', 'p1'); m.set('userId', 'x'); m.set('text', said); m.set('createdAt', Date.now())
      posts.push([m])
    })
  }
  talk('w1', { title: 'Webinar speakers' }, 'Bea will ask two partners to speak at the webinar.')
  talk('q1', { title: 'October or November?', kind: 'question', status: 'answered', answer: 'November, after the security review.', answeredBy: 'x' }, 'Security needs two more weeks.')
  await until(() => room.doc.getMap('discussions').get('q1').get('decisionNumber') === 1, 'D-1 recorded')
  await sleep(ALARM)
  text.close(); room.close()
})
after(() => app.stop())

const act = async (path, cookie, fields) => {
  const r = await fetch(`${app.base}${path}.data`, { method: 'POST', body: new URLSearchParams(fields), headers: { cookie } })
  return { status: r.status, text: await r.text() }
}
const page = async (path, cookie) => (await fetch(app.base + path, { headers: { cookie } })).text()

test('asking the space answers from its documents and discussions, and names them as sources', async () => {
  const out = await act(`/space/${spaceId}`, cy.cookie, { intent: 'ask', question: 'When is the webinar?' }) // a viewer may ask
  assert.equal(out.status, 200)
  assert.match(out.text, /AI space/)
  assert.match(out.text, /Webinar plan/, 'the document is a source')
  assert.match(out.text, /Webinar speakers/, 'the discussion is a source')
  assert.match(out.text, /\/decision\/q:q1/, 'the decision in force is a source')
  assert.equal((await app.post(`/space/${spaceId}`, dee.cookie, { intent: 'ask', question: 'webinar' })).status, 404, 'a stranger')
  assert.match((await act(`/space/${spaceId}`, eve.cookie, { intent: 'ask', question: 'webinar' })).text, /Nib is off/)
})

test('next steps map the proposed assignee to a member and keep a valid date; viewers cannot ask', async () => {
  const out = await act(`/space/${spaceId}`, bea.cookie, { intent: 'propose', discussion: 'w1' })
  assert.match(out.text, /Book the webinar room/)
  assert.match(out.text, new RegExp(beaId), 'Bea by name becomes Bea by id')
  assert.match(out.text, /2031-05-04/)
  assert.match(out.text, /Launch in November/)
  assert.equal((await app.post(`/space/${spaceId}`, cy.cookie, { intent: 'propose', discussion: 'w1' })).status, 403, 'a viewer')
})

test('submitting for review runs Nib\'s check; it finds D-1 and links to it', async () => {
  assert.equal((await app.post(`/doc/${docId}`, ada.cookie, { intent: 'status', move: 'submit' })).status, 200)
  let html = ''
  for (let i = 0; i < 50 && !/The text says October/.test(html); i++) { await sleep(200); html = await page(`/doc/${docId}`, bea.cookie) }
  assert.match(html, /The text says October, but D-1 decided November/)
  assert.match(html, /\/decision\/q:q1/)
  assert.equal((await app.post(`/doc/${docId}`, cy.cookie, { intent: 'check' })).status, 403, 'a viewer cannot ask for a check')
})

test('a document outside a space is checked against its owner\'s own decisions', async () => {
  const log = await app.createDocument(ada.cookie, 'My decisions')
  const tab = app.openTab(log, ada.cookie)
  await until(() => tab.provider.synced, 'synced')
  const el = new Y.XmlElement('decision')
  el.setAttribute('decisionId', 'mine-1'); el.setAttribute('status', 'decided'); el.setAttribute('number', 0)
  el.insert(0, [new Y.XmlText('Ship in November')])
  tab.doc.getXmlFragment('document-store').push([el])
  await until(() => Number(el.getAttribute('number')) === 1, 'numbered')
  tab.close()

  const draft = await app.createDocument(ada.cookie, 'Draft')
  const t2 = app.openTab(draft, ada.cookie)
  await until(() => t2.provider.synced, 'synced')
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText('We ship in October.')])
  t2.doc.getXmlFragment('document-store').push([p])
  await sleep(ALARM)
  t2.close()

  assert.equal((await app.post(`/doc/${draft}`, ada.cookie, { intent: 'check' })).status, 200)
  let html = ''
  for (let i = 0; i < 50 && !/decision\/mine-1/.test(html); i++) { await sleep(200); html = await page(`/doc/${draft}`, ada.cookie) }
  assert.match(html, /\/decision\/mine-1/)
})
