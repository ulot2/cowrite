import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { startApp, until } from './harness.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ALARM = 3800 // the room indexes into D1 three seconds after a change

let app, ada, bea, cy, dee, beaId, spaceId
before(async () => {
  app = await startApp()
  ada = await app.signUpUser('Ada')
  bea = await app.signUpUser('Bea')
  cy = await app.signUpUser('Cy')
  dee = await app.signUpUser('Dee')
  beaId = (await (await fetch(`${app.base}/api/auth/get-session`, { headers: { cookie: bea.cookie } })).json()).user.id
  const res = await app.post('/?index', ada.cookie, { intent: 'new-space', name: 'Launch' })
  spaceId = res.headers.get('location').split('/').pop()
  await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'add', email: bea.email, role: 'editor' })
  await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'add', email: cy.email, role: 'viewer' })
})
after(() => app.stop())

// The space's room, reached at /ws/space/<id>. The harness puts the room name after /ws/.
const room = (cookie) => app.openTab(`space/${spaceId}`, cookie)
const discussions = (tab) => tab.doc.getMap('discussions')

// A discussion the way the client writes it.
const ask = (tab, title, extra = {}) => {
  const d = new Y.Map()
  const posts = new Y.Array()
  tab.doc.transact(() => {
    discussions(tab).set(title, d)
    for (const [k, v] of Object.entries({ title, kind: 'talk', status: 'open', createdBy: 'x', createdAt: Date.now(), ...extra })) d.set(k, v)
    d.set('posts', posts)
    const p = new Y.Map()
    p.set('id', 'p1'); p.set('userId', 'x'); p.set('text', 'Tolu, update the pricing section'); p.set('createdAt', Date.now())
    posts.push([p])
  })
  return d
}

test('members share the room live; a viewer reads only; a stranger is refused', async () => {
  const a = room(ada.cookie), b = room(bea.cookie), c = room(cy.cookie)
  await until(() => a.provider.synced && b.provider.synced && c.provider.synced, 'synced')
  ask(a, 'Pricing tiers')
  await until(() => discussions(b).has('Pricing tiers'), 'Bea sees the discussion')
  ask(c, 'From a viewer')
  await sleep(500)
  assert.equal(discussions(a).has('From a viewer'), false, 'the viewer write is dropped')
  assert.equal(await app.handshakeStatus(`space/${spaceId}`, dee.cookie), 403)
  a.close(); b.close(); c.close()
})

test('an open question shows on the space home with who decides and the date, and reaches the bell', async () => {
  const a = room(ada.cookie)
  await until(() => a.provider.synced, 'synced')
  ask(a, 'October or November?', { kind: 'question', owner: beaId, due: '2030-10-01' })
  await sleep(ALARM)
  a.close()
  const html = await (await fetch(`${app.base}/space/${spaceId}`, { headers: { cookie: ada.cookie } })).text()
  assert.match(html, /data-verb="Decide">Decide<\/span><span class="attention-title">October or November\?/)
  assert.match(html, /Oct 1</)
  const inbox = await (await fetch(`${app.base}/api/inbox`, { headers: { cookie: bea.cookie } })).json()
  assert.ok(inbox.events.some((e) => e.type === 'discussion' && e.text.startsWith('asked “October or November?”')))
})

test('a task from a post reaches the Tasks page, and ticking it there ticks it in the room', async () => {
  const a = room(ada.cookie)
  await until(() => a.provider.synced, 'synced')
  a.doc.getMap('tasks').set('t-1', { text: 'Update the pricing section', assignee: beaId, assigneeName: 'Bea', due: '', done: false, discussionId: 'Pricing tiers', postId: 'p1', createdBy: 'x' })
  await sleep(ALARM)
  assert.match(await (await fetch(`${app.base}/tasks`, { headers: { cookie: bea.cookie } })).text(), /Update the pricing section/)
  assert.equal((await app.post('/tasks', dee.cookie, { id: 't-1', done: 'true' })).status, 404, 'a stranger')
  assert.equal((await app.post('/tasks', bea.cookie, { id: 't-1', done: 'true' })).status, 200)
  await until(() => a.doc.getMap('tasks').get('t-1')?.done === true, 'the room ticks the task')
  a.close()
})

test('deleting the space takes its discussions and their tasks', async () => {
  await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'delete-space' })
  assert.doesNotMatch(await (await fetch(`${app.base}/tasks`, { headers: { cookie: bea.cookie } })).text(), /Update the pricing section/)
  assert.equal(await app.handshakeStatus(`space/${spaceId}`, ada.cookie), 403, 'the space is gone')
})
