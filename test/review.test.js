import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startApp, until } from './harness.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const neverArrives = async (cond, what) => { await sleep(700); assert.equal(cond(), false, what) }
const json = async (path, cookie, init = {}) => (await fetch(`${app.base}${path}`, { ...init, headers: { cookie, ...(init.headers ?? {}) } })).json()

let app, ada, bea, beaId, docId
before(async () => {
  app = await startApp()
  ada = await app.signUpUser('Ada')
  bea = await app.signUpUser('Bea')
  beaId = (await json('/api/auth/get-session', bea.cookie)).user.id
  docId = await app.createDocument(ada.cookie, 'Reviewed')
})
after(() => app.stop())

test('a reviewer can write to the text (their editor makes it a suggestion); a commenter still cannot', async () => {
  assert.equal((await app.post(`/doc/${docId}`, ada.cookie, { intent: 'add', email: bea.email, role: 'commenter' })).status, 200)
  const owner = app.openTab(docId, ada.cookie)
  let other = app.openTab(docId, bea.cookie)
  await until(() => other.provider.synced, 'commenter synced')
  other.text.insert(0, 'as commenter')
  await neverArrives(() => owner.text.toString().includes('commenter'), 'the commenter edit reached the owner')
  other.close()

  assert.equal((await app.post(`/doc/${docId}`, ada.cookie, { intent: 'role', user_id: beaId, role: 'reviewer' })).status, 200)
  other = app.openTab(docId, bea.cookie)
  await until(() => other.provider.synced, 'reviewer synced')
  other.text.insert(0, 'as reviewer')
  await until(() => owner.text.toString().includes('as reviewer'), 'the reviewer edit reached the owner')
  owner.close(); other.close()
})

test('status moves follow the ladder and the roles, and each one is logged', async () => {
  const page = async (cookie) => (await fetch(`${app.base}/documents`, { headers: { cookie } })).text()
  // Bea is a reviewer: she cannot submit (editor+), and the document is still a draft.
  assert.equal((await app.post(`/doc/${docId}`, bea.cookie, { intent: 'status', move: 'submit' })).status, 403)
  // Ada submits; the card says so.
  assert.equal((await app.post(`/doc/${docId}`, ada.cookie, { intent: 'status', move: 'submit' })).status, 200)
  assert.match(await page(ada.cookie), /In review/)
  // The same move twice is refused politely (the document is not a draft any more).
  const again = await app.post(`/doc/${docId}`, ada.cookie, { intent: 'status', move: 'submit' })
  assert.equal(again.status, 200)
  // Bea approves; Ada reopens.
  assert.equal((await app.post(`/doc/${docId}`, bea.cookie, { intent: 'status', move: 'approve' })).status, 200)
  assert.match(await page(ada.cookie), /Approved/)
  assert.equal((await app.post(`/doc/${docId}`, bea.cookie, { intent: 'status', move: 'reopen' })).status, 403)
  assert.equal((await app.post(`/doc/${docId}`, ada.cookie, { intent: 'status', move: 'reopen' })).status, 200)
  assert.doesNotMatch(await page(ada.cookie), /Approved|In review/)
  const history = await (await fetch(`${app.base}/doc/${docId}/history`, { headers: { cookie: ada.cookie } })).text()
  for (const text of ['submitted for review', 'approved', 'reopened']) assert.match(history, new RegExp(text))
})

test('the inbox counts what other people did since the bell was last opened', async () => {
  // Bea sees Ada's moves on the shared document; Ada never sees her own.
  let inbox = await json('/api/inbox', bea.cookie)
  assert.ok(inbox.unseen >= 3, 'Bea has unseen events')
  assert.ok(inbox.events.every((e) => e.actor === 'Ada'), 'only other people')
  const mine = await json('/api/inbox', ada.cookie)
  assert.ok(mine.events.every((e) => e.actor !== 'Ada'), 'Ada does not see her own actions')

  // Opening the bell marks everything seen. A new rename counts again.
  assert.equal((await fetch(`${app.base}/api/inbox`, { method: 'POST', headers: { cookie: bea.cookie } })).status, 200)
  inbox = await json('/api/inbox', bea.cookie)
  assert.equal(inbox.unseen, 0)
  await sleep(5) // the rename must land after seen_at
  await app.post(`/doc/${docId}`, ada.cookie, { intent: 'rename', title: 'Reviewed twice' })
  inbox = await json('/api/inbox', bea.cookie)
  assert.equal(inbox.unseen, 1)
  assert.match(inbox.events[0].text, /renamed/)
  assert.equal((await fetch(`${app.base}/api/inbox`, { redirect: 'manual' })).status, 302, 'signed out: sent to login')
})

test('accepting a suggestion is logged for its author; only editors may log one', async () => {
  assert.equal((await app.post(`/doc/${docId}`, bea.cookie, { intent: 'suggestion', outcome: 'accepted', author: beaId })).status, 403)
  assert.equal((await app.post(`/doc/${docId}`, ada.cookie, { intent: 'suggestion', outcome: 'rejected', author: beaId })).status, 200)
  const inbox = await json('/api/inbox', bea.cookie)
  assert.equal(inbox.events[0].text, 'rejected a suggestion by Bea')
})

test('a mention in a comment becomes an event for the mentioned person', async () => {
  const { YjsThreadStore } = await import('@blocknote/core/yjs')
  const { DefaultThreadStoreAuth } = await import('@blocknote/core/comments')
  const adaId = (await json('/api/auth/get-session', ada.cookie)).user.id
  const tab = app.openTab(docId, bea.cookie, 'threads')
  await until(() => tab.provider.synced, 'threads synced')
  const store = new YjsThreadStore(beaId, tab.doc.getMap('threads'), new DefaultThreadStoreAuth(beaId, 'comment'))
  await store.createThread({ initialComment: { body: [{ type: 'paragraph', content: [{ type: 'text', text: 'Look ', styles: {} }, { type: 'mention', props: { user: adaId, name: 'Ada' } }] }] } })
  await sleep(3800) // the threads object scans new comments when its alarm runs
  tab.close()
  const inbox = await json('/api/inbox', ada.cookie)
  assert.ok(inbox.events.some((e) => e.actor === 'Bea' && e.text === 'mentioned Ada in a comment'), JSON.stringify(inbox.events.map((e) => e.text)))
})
