import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { startApp, until } from './harness.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ALARM = 3800 // the object indexes tasks and decisions three seconds after an edit

// A block the way the editor stores it: a content node with its props as attributes.
const add = (tab, type, attrs, text) => {
  const el = new Y.XmlElement(type)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  el.insert(0, [new Y.XmlText(text)])
  tab.doc.getXmlFragment('document-store').push([el])
  return el
}

let app, ada, bea, cy, adaId, beaId
before(async () => {
  app = await startApp()
  ada = await app.signUpUser('Ada')
  bea = await app.signUpUser('Bea')
  cy = await app.signUpUser('Cy')
  const id = async (u) => (await (await fetch(`${app.base}/api/auth/get-session`, { headers: { cookie: u.cookie } })).json()).user.id
  adaId = await id(ada)
  beaId = await id(bea)
})
after(() => app.stop())

const get = async (path, cookie) => (await fetch(app.base + path, { headers: { cookie } })).text()
const json = async (path, cookie) => (await fetch(app.base + path, { headers: { cookie } })).json()

test('a task in a document reaches its assignee, and ticking it on the Tasks page ticks the block', async () => {
  const docId = await app.createDocument(ada.cookie, 'Launch')
  await app.post(`/doc/${docId}`, ada.cookie, { intent: 'add', email: bea.email, role: 'commenter' })
  const tab = app.openTab(docId, ada.cookie)
  await until(() => tab.provider.synced, 'synced')
  const el = add(tab, 'task', { taskId: 't-1', assignee: beaId, assigneeName: 'Bea', due: '2026-10-01', done: false }, 'Book the venue')
  await sleep(ALARM)

  assert.match(await get('/tasks', bea.cookie), /Book the venue/)
  const inbox = await json('/api/inbox', bea.cookie)
  assert.ok(inbox.events.some((e) => e.text.startsWith('assigned Bea a task')), 'the assignee hears about it')

  // Bea is only a commenter, but the task is hers, so she may tick it.
  assert.equal((await app.post('/tasks', bea.cookie, { id: 't-1', done: 'true' })).status, 200)
  await until(() => String(el.getAttribute('done')) === 'true', 'the open document ticks the block')
  assert.equal((await app.post('/tasks', cy.cookie, { id: 't-1', done: 'false' })).status, 404, 'a stranger')
  tab.close()
})

test('decisions get numbers per space, written back into the blocks and listed on the space', async () => {
  const space = await app.post('/?index', ada.cookie, { intent: 'new-space', name: 'Product' })
  const spaceId = space.headers.get('location').split('/').pop()
  const docId = await app.createDocument(ada.cookie, 'Pricing')
  await app.post(`/doc/${docId}`, ada.cookie, { intent: 'move', space_id: spaceId })
  const tab = app.openTab(docId, ada.cookie)
  await until(() => tab.provider.synced, 'synced')
  const a = add(tab, 'decision', { decisionId: 'd-a', status: 'decided', number: 0 }, 'Free plan stays free')
  const b = add(tab, 'decision', { decisionId: 'd-b', status: 'proposed', number: 0 }, 'Annual billing')
  await until(() => Number(a.getAttribute('number')) > 0 && Number(b.getAttribute('number')) > 0, 'numbers written back', 8000)
  assert.deepEqual([Number(a.getAttribute('number')), Number(b.getAttribute('number'))].sort(), [1, 2])
  tab.close()
  const html = await get(`/space/${spaceId}`, ada.cookie)
  assert.match(html, /D-1/)
  assert.match(html, /D-2/)
  assert.match(html, /Free plan stays free/)
})

test('Plan mode starts a document with the template, a task block included', async () => {
  const res = await app.post('/?index', ada.cookie, { intent: 'create', mode: 'plan' })
  assert.equal(res.status, 302)
  const id = res.headers.get('location').split('/').pop()
  const md = await get(`/doc/${id}/export?format=md`, ada.cookie)
  for (const h of ['## Goal', '## Tasks', '## Decisions', '## Timeline']) assert.match(md, new RegExp(h))
  assert.match(md, /- \[ \] First step/)
})

test('a board: its columns come seeded, a card made a task is on the Tasks page, a card can become a document', async () => {
  const res = await app.post('/?index', ada.cookie, { intent: 'create', mode: 'brainstorm' })
  const id = res.headers.get('location').split('/').pop()
  const tab = app.openTab(id, ada.cookie)
  await until(() => tab.provider.synced && tab.doc.getArray('groups').length === 3, 'three columns')
  const card = new Y.Map()
  tab.doc.transact(() => {
    tab.doc.getMap('cards').set('c-1', card)
    card.set('text', 'Try a weekly digest'); card.set('group', tab.doc.getArray('groups').get(0).id); card.set('pos', 1); card.set('votes', new Y.Map())
    card.set('task', { assignee: adaId, assigneeName: 'Ada', due: '', done: false })
  })
  await sleep(ALARM)
  tab.close()
  assert.match(await get('/tasks', ada.cookie), /Try a weekly digest/)
  assert.match(await get(`/doc/${id}/export?format=md`, ada.cookie), /## Ideas[^]*- \[ \] Try a weekly digest/)

  assert.equal((await app.post(`/doc/${id}`, ada.cookie, { intent: 'card-doc', title: 'Weekly digest' })).status, 200)
  assert.match(await get('/documents', ada.cookie), /Weekly digest/)
})

test('the review queue lists documents waiting for you, not the ones you submitted', async () => {
  const docId = await app.createDocument(ada.cookie, 'Ready for eyes')
  await app.post(`/doc/${docId}`, ada.cookie, { intent: 'add', email: bea.email, role: 'reviewer' })
  await app.post(`/doc/${docId}`, ada.cookie, { intent: 'status', move: 'submit' })
  assert.match(await get('/review', bea.cookie), /Ready for eyes/)
  assert.doesNotMatch(await get('/review', ada.cookie), /Ready for eyes/)
})
