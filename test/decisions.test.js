import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { startApp, until } from './harness.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ALARM = 3800

let app, ada, bea, cy, dee, spaceId, docId
before(async () => {
  app = await startApp()
  ada = await app.signUpUser('Ada')
  bea = await app.signUpUser('Bea')
  cy = await app.signUpUser('Cy')
  dee = await app.signUpUser('Dee')
  spaceId = (await app.post('/?index', ada.cookie, { intent: 'new-space', name: 'Launch' })).headers.get('location').split('/').pop()
  await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'add', email: bea.email, role: 'editor' })
  await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'add', email: cy.email, role: 'viewer' })
})
after(() => app.stop())

const page = async (path, cookie) => { const r = await fetch(app.base + path, { headers: { cookie }, redirect: 'manual' }); return { status: r.status, html: await r.text() } }

test('an answered question becomes D-1, numbered back into the room, with the thread as its reason', async () => {
  const tab = app.openTab(`space/${spaceId}`, ada.cookie)
  await until(() => tab.provider.synced, 'synced')
  const d = new Y.Map()
  const posts = new Y.Array()
  tab.doc.transact(() => {
    tab.doc.getMap('discussions').set('q1', d)
    for (const [k, v] of Object.entries({ title: 'October or November?', kind: 'question', status: 'open', createdBy: 'x', createdAt: Date.now() })) d.set(k, v)
    d.set('posts', posts)
    const p = new Y.Map()
    p.set('id', 'p1'); p.set('userId', 'x'); p.set('text', 'The security review needs two more weeks.'); p.set('createdAt', Date.now())
    posts.push([p])
  })
  await sleep(ALARM)
  // The page also carries its loader data, so check the rendered log rows, not any text.
  assert.doesNotMatch((await page(`/space/${spaceId}?tab=decisions`, ada.cookie)).html, /class="decision-number"/, 'an open question is not a decision')

  tab.doc.transact(() => { d.set('status', 'answered'); d.set('answer', 'November 12, after the security review.'); d.set('answeredBy', 'x') })
  await until(() => d.get('decisionNumber') === 1, 'the number is written into the room')
  tab.close()

  const log = (await page(`/space/${spaceId}?tab=decisions`, ada.cookie)).html
  assert.match(log, /class="decision-number"[^>]*>D-1</)
  const record = await page('/decision/q:q1', bea.cookie)
  assert.equal(record.status, 200)
  assert.match(record.html, /November 12, after the security review\./)
  assert.match(record.html, /The security review needs two more weeks\./, 'the discussion is the reason')
  assert.equal((await page('/decision/q:q1', dee.cookie)).status, 404, 'a stranger')
})

test('a decision block in a space document takes the next number, D-2', async () => {
  docId = (await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'create', mode: 'write' })).headers.get('location').split('/').pop()
  const tab = app.openTab(docId, ada.cookie)
  await until(() => tab.provider.synced, 'synced')
  const el = new Y.XmlElement('decision')
  el.setAttribute('decisionId', 'd-2'); el.setAttribute('status', 'decided'); el.setAttribute('number', 0)
  el.insert(0, [new Y.XmlText('Launch on November 12')])
  tab.doc.getXmlFragment('document-store').push([el])
  await until(() => Number(el.getAttribute('number')) === 2, 'D-2 written into the block')
  tab.close()
  const record = await page('/decision/d-2', bea.cookie)
  assert.equal(record.status, 200)
  assert.match(record.html, /Launch on November 12/)
  assert.match(record.html, /Recorded in the document/)
})

test('D-2 replaces D-1: D-1 says so, the log in force hides it; viewers and cycles are refused', async () => {
  assert.equal((await app.post('/decision/d-2', cy.cookie, { intent: 'supersede', older: 'q:q1' })).status, 403, 'a viewer')
  assert.equal((await app.post('/decision/d-2', bea.cookie, { intent: 'supersede', older: 'q:q1' })).status, 200)
  const older = (await page('/decision/q:q1', ada.cookie)).html
  assert.match(older, /replaced by/i)
  assert.match(older, /D-2/)
  assert.match((await page('/decision/d-2', ada.cookie)).html, /Replaces/)
  const log = (await page(`/space/${spaceId}?tab=decisions`, ada.cookie)).html
  assert.match(log, />D-2</)
  assert.doesNotMatch(log, /data-replaced/, 'in force hides the replaced one')

  const cycle = await fetch(`${app.base}/decision/q:q1.data`, { method: 'POST', body: new URLSearchParams({ intent: 'supersede', older: 'd-2' }), headers: { cookie: ada.cookie } })
  assert.match(await cycle.text(), /already/)
})
