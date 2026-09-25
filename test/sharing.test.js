import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startApp, until } from './harness.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Waits long enough for an update to arrive, then checks that it did not.
const neverArrives = async (cond, what) => { await sleep(700); assert.equal(cond(), false, what) }

let app, ada, grace, docId
before(async () => {
  app = await startApp()
  ada = await app.signUpUser('Ada')
  grace = await app.signUpUser('Grace')
  docId = await app.createDocument(ada.cookie, 'Shared')
})
after(() => app.stop())

test('a viewer reads the text but cannot change it, and cannot comment', async () => {
  assert.equal((await app.post(`/doc/${docId}`, ada.cookie, { intent: 'add', email: grace.email, role: 'viewer' })).status, 200)
  const owner = app.openTab(docId, ada.cookie)
  owner.text.insert(0, 'hello')
  const viewer = app.openTab(docId, grace.cookie)
  await until(() => viewer.text.toString() === 'hello', 'the viewer reads the text')

  viewer.text.insert(5, ' from grace')
  await neverArrives(() => owner.text.toString().includes('grace'), 'the viewer edit reached the owner')

  const ownerThreads = app.openTab(docId, ada.cookie, 'threads')
  const viewerThreads = app.openTab(docId, grace.cookie, 'threads')
  await until(() => viewerThreads.provider.synced, 'threads synced')
  viewerThreads.threads.set('t1', 'not allowed')
  await neverArrives(() => ownerThreads.threads.has('t1'), 'the viewer comment reached the owner')
  owner.close(); viewer.close(); ownerThreads.close(); viewerThreads.close()
})

test('a commenter can comment but still cannot change the text; a role change applies on the next connect', async () => {
  const graceId = (await (await fetch(`${app.base}/api/auth/get-session`, { headers: { cookie: grace.cookie } })).json()).user.id
  assert.equal((await app.post(`/doc/${docId}`, ada.cookie, { intent: 'role', user_id: graceId, role: 'commenter' })).status, 200)

  const owner = app.openTab(docId, ada.cookie)
  const commenter = app.openTab(docId, grace.cookie)
  await until(() => commenter.provider.synced, 'text synced')
  commenter.text.insert(0, 'X')
  await neverArrives(() => owner.text.toString().startsWith('X'), 'the commenter edit reached the owner')

  const ownerThreads = app.openTab(docId, ada.cookie, 'threads')
  const commenterThreads = app.openTab(docId, grace.cookie, 'threads')
  await until(() => commenterThreads.provider.synced, 'threads synced')
  commenterThreads.threads.set('t2', 'a comment')
  await until(() => ownerThreads.threads.get('t2') === 'a comment', 'the comment reached the owner')
  owner.close(); commenter.close(); ownerThreads.close(); commenterThreads.close()
})

test('a share link lets a stranger in with the role on the link', async () => {
  const bob = await app.signUpUser('Bob')
  assert.equal(await app.handshakeStatus(docId, bob.cookie), 403)

  assert.equal((await app.post(`/doc/${docId}`, ada.cookie, { intent: 'link-create', role: 'viewer' })).status, 200)
  const html = await (await fetch(`${app.base}/doc/${docId}`, { headers: { cookie: ada.cookie } })).text()
  const token = html.match(/\/s\/([0-9a-f]{64})/)[1]

  const follow = await fetch(`${app.base}/s/${token}`, { headers: { cookie: bob.cookie }, redirect: 'manual' })
  assert.equal(follow.status, 302)
  assert.equal(follow.headers.get('location'), `/doc/${docId}`)
  assert.equal(await app.handshakeStatus(docId, bob.cookie), 101)

  // Signed out, the link goes through login and comes back.
  const anonymous = await fetch(`${app.base}/s/${token}`, { redirect: 'manual' })
  assert.equal(anonymous.status, 302)
  assert.equal(anonymous.headers.get('location'), `/login?next=${encodeURIComponent(`/s/${token}`)}`)
})

test('a space shares its documents with its members, and hides them from everyone else', async () => {
  const made = await app.post('/?index', ada.cookie, { intent: 'new-space', name: 'Marketing' })
  assert.equal(made.status, 302)
  const spaceId = made.headers.get('location').split('/').pop()

  const created = await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'create' })
  assert.equal(created.status, 302)
  const inSpace = created.headers.get('location').split('/').pop()

  assert.equal((await fetch(`${app.base}/space/${spaceId}`, { headers: { cookie: grace.cookie } })).status, 404)
  assert.equal(await app.handshakeStatus(inSpace, grace.cookie), 403)

  assert.equal((await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'add', email: grace.email, role: 'editor' })).status, 200)
  assert.equal((await fetch(`${app.base}/space/${spaceId}`, { headers: { cookie: grace.cookie } })).status, 200)
  const owner = app.openTab(inSpace, ada.cookie)
  const editor = app.openTab(inSpace, grace.cookie)
  await until(() => editor.provider.synced, 'editor synced')
  editor.text.insert(0, 'from a space editor')
  await until(() => owner.text.toString() === 'from a space editor', 'the space editor can write')
  owner.close(); editor.close()

  const html = await (await fetch(`${app.base}/documents`, { headers: { cookie: grace.cookie } })).text()
  assert.match(html, /Marketing/)
})

test('the owner can delete a space; its documents stay with their owner, space-only members lose them', async () => {
  const space = await app.post('/?index', ada.cookie, { intent: 'new-space', name: 'Temporary' })
  const spaceId = space.headers.get('location').split('/').pop()
  const docId = await app.createDocument(ada.cookie, 'Kept after the space')
  await app.post(`/doc/${docId}`, ada.cookie, { intent: 'move', space_id: spaceId })
  await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'add', email: grace.email, role: 'editor' })
  assert.equal((await fetch(`${app.base}/doc/${docId}`, { headers: { cookie: grace.cookie } })).status, 200)

  assert.equal((await app.post(`/space/${spaceId}`, grace.cookie, { intent: 'delete-space' })).status, 403, 'only the owner')
  assert.equal((await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'delete-space' })).status, 302)
  assert.equal((await fetch(`${app.base}/space/${spaceId}`, { headers: { cookie: ada.cookie } })).status, 404)
  assert.equal((await fetch(`${app.base}/doc/${docId}`, { headers: { cookie: ada.cookie } })).status, 200, 'the owner keeps the document')
  assert.equal((await fetch(`${app.base}/doc/${docId}`, { headers: { cookie: grace.cookie } })).status, 404, 'access through the space is gone')
})

test('a guest makes documents without an account, and they move into the account on sign-up', async () => {
  // "Try it": a first guest document, and the guest cookie.
  const play = await fetch(`${app.base}/play`, { redirect: 'manual' })
  assert.equal(play.status, 302)
  const guest = play.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const id = play.headers.get('location').split('/').pop()
  const file = `${app.base}/doc/${id}/export?format=md`
  const md = await fetch(file, { headers: { cookie: guest } })
  assert.equal(md.status, 200)
  assert.match(await md.text(), /This document is yours to try CoWrite/, 'filled with the tour')
  assert.equal((await fetch(file, { redirect: 'manual' })).status, 302, 'another browser is sent to sign in')

  // Ten documents at most.
  for (let i = 1; i < 10; i++) assert.equal((await app.post('/g', guest, {})).status, 302, `document ${i + 1}`)
  assert.match(await (await app.post('/g', guest, {})).text(), /the most without an account/, 'the eleventh')

  // Sign up in the same browser: the first page claims them.
  const { cookie } = await app.signUpUser('Guest')
  const welcome = await fetch(`${app.base}/welcome`, { headers: { cookie: `${cookie}; ${guest}` }, redirect: 'manual' })
  assert.equal(welcome.headers.get('location'), '/documents?saved=10')
  const mine = await fetch(file, { headers: { cookie } })
  assert.equal(mine.status, 200, 'the account opens it')
  assert.match(await mine.text(), /yours to try CoWrite/, 'with the same text')
})
