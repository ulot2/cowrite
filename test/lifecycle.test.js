import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { startApp, until } from './harness.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ALARM = 3800

let app, ada, bea, cy, dee, spaceId
before(async () => {
  app = await startApp()
  ada = await app.signUpUser('Ada')
  bea = await app.signUpUser('Bea')
  cy = await app.signUpUser('Cy')
  dee = await app.signUpUser('Dee')
  spaceId = (await app.post('/?index', ada.cookie, { intent: 'new-space', name: 'Launch' })).headers.get('location').split('/').pop()
  await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'add', email: bea.email, role: 'reviewer' })
  await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'add', email: cy.email, role: 'commenter' })
  await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'add', email: dee.email, role: 'viewer' })
})
after(() => app.stop())

const page = async (path, cookie) => (await fetch(app.base + path, { headers: { cookie } })).text()
// An action's returned data (the .data endpoint), as text.
const act = async (path, cookie, fields) => (await fetch(`${app.base}${path}.data`, { method: 'POST', body: new URLSearchParams(fields), headers: { cookie } })).text()
const move = (docId, cookie, m) => app.post(`/doc/${docId}`, cookie, { intent: 'status', move: m })

test('the ideas board seeds once, and an idea turned into a discussion reaches another member with its text', async () => {
  await page(`/space/${spaceId}?tab=ideas`, ada.cookie)
  await page(`/space/${spaceId}?tab=ideas`, cy.cookie) // a second open does not add columns
  const cyTab = app.openTab(`space/${spaceId}`, cy.cookie)
  const adaTab = app.openTab(`space/${spaceId}`, ada.cookie)
  await until(() => cyTab.provider.synced && adaTab.provider.synced, 'synced')
  const groups = cyTab.doc.getArray('groups')
  assert.deepEqual(groups.toArray().map((g) => g.name), ['New', 'Exploring', 'Picked'])

  // Cy (a commenter) writes an idea and turns it into a discussion, the way the board does.
  const card = new Y.Map(), d = new Y.Map(), posts = new Y.Array(), first = new Y.Map()
  cyTab.doc.transact(() => {
    cyTab.doc.getMap('cards').set('c1', card)
    card.set('text', 'Partner webinar'); card.set('group', groups.get(0).id); card.set('pos', 1); card.set('votes', new Y.Map())
    cyTab.doc.getMap('discussions').set('from-idea', d)
    for (const [k, v] of Object.entries({ title: 'Partner webinar', kind: 'talk', status: 'open', createdBy: 'x', createdAt: Date.now(), idea: 'c1' })) d.set(k, v)
    d.set('posts', posts)
    first.set('id', 'p1'); first.set('userId', 'x'); first.set('text', 'Partner webinar'); first.set('createdAt', Date.now())
    posts.push([first])
    card.set('discussion', 'from-idea')
  })
  const seen = () => adaTab.doc.getMap('discussions').get('from-idea')
  await until(() => seen()?.get('posts')?.get(0)?.get('text') === 'Partner webinar', 'the discussion reached Ada')
  assert.equal(seen().get('idea'), 'c1')
  assert.equal(adaTab.doc.getMap('cards').get('c1').get('discussion'), 'from-idea')
  cyTab.close(); adaTab.close()

  // A viewer's idea is dropped.
  const deeTab = app.openTab(`space/${spaceId}`, dee.cookie)
  const check = app.openTab(`space/${spaceId}`, ada.cookie)
  await until(() => deeTab.provider.synced && check.provider.synced, 'synced')
  deeTab.doc.getMap('cards').set('c2', new Y.Map())
  await sleep(700)
  assert.equal(check.doc.getMap('cards').has('c2'), false, 'a viewer wrote to the board')
  deeTab.close(); check.close()
  await sleep(ALARM)
  assert.match(await page(`/space/${spaceId}`, ada.cookie), /Partner webinar/, 'the discussion is on the Overview')
})

let docId
test('an idea becomes a document in the Idea state; a commenter cannot make one', async () => {
  assert.equal((await app.post(`/space/${spaceId}`, cy.cookie, { intent: 'card-doc', title: 'Commenter idea' })).status, 403)
  const data = await act(`/space/${spaceId}`, ada.cookie, { intent: 'card-doc', title: 'Pricing page' })
  docId = data.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0]
  assert.ok(docId, 'the new id comes back')
  assert.match(await page(`/space/${spaceId}?tab=documents`, ada.cookie), /data-status="idea"/)
  assert.equal((await move(docId, bea.cookie, 'start')).status, 403, 'a reviewer cannot start drafting')
  assert.equal((await move(docId, ada.cookie, 'start')).status, 200)
  assert.doesNotMatch(await page(`/space/${spaceId}?tab=documents`, ada.cookie), /data-status="idea"/)
})

test('sign-off: a concern blocks approval until it is withdrawn; viewers and drafts are refused', async () => {
  const sign = (cookie, block, state, note = '') => act(`/doc/${docId}`, cookie, { intent: 'signoff', block, state, note, heading: block === 'h1' ? 'Goal' : 'Risks', hash: 'abc' })
  assert.match(await sign(bea.cookie, 'h1', 'agree'), /in review/, 'a draft cannot be signed off')
  assert.equal((await move(docId, ada.cookie, 'submit')).status, 200)
  assert.equal((await app.post(`/doc/${docId}`, dee.cookie, { intent: 'signoff', block: 'h1', state: 'agree' })).status, 403, 'a viewer')

  await sign(bea.cookie, 'h1', 'agree')
  await sign(bea.cookie, 'h2', 'concern', 'The refund rule is missing')
  const blocked = await act(`/doc/${docId}`, bea.cookie, { intent: 'status', move: 'approve' })
  assert.match(blocked, /Resolve the concern on “Risks” first/)
  assert.match(await page(`/doc/${docId}`, ada.cookie), /The refund rule is missing/, 'the concern shows')
  assert.match(await page(`/space/${spaceId}`, ada.cookie), /raised a concern on “Risks”/, 'the concern is in the activity')

  await act(`/doc/${docId}`, bea.cookie, { intent: 'unsignoff', block: 'h2' })
  assert.equal((await move(docId, bea.cookie, 'approve')).status, 200)
  assert.match(await page(`/space/${spaceId}?tab=documents`, ada.cookie), /data-status="approved"/)
})

test('approved → done → reopen, and going back to draft clears the sign-offs', async () => {
  assert.equal((await move(docId, dee.cookie, 'finish')).status, 403, 'a viewer')
  assert.equal((await move(docId, ada.cookie, 'finish')).status, 200)
  assert.match(await page(`/space/${spaceId}?tab=documents`, ada.cookie), /data-status="done"/)
  assert.equal((await move(docId, ada.cookie, 'reopen')).status, 200)

  // A second round: a concern, then "Request changes" wipes it.
  await move(docId, ada.cookie, 'submit')
  await act(`/doc/${docId}`, bea.cookie, { intent: 'signoff', block: 'h1', state: 'concern', note: 'Second-round worry', heading: 'Goal', hash: 'x' })
  assert.match(await page(`/doc/${docId}`, ada.cookie), /Second-round worry/)
  await move(docId, bea.cookie, 'changes')
  assert.doesNotMatch(await page(`/doc/${docId}`, ada.cookie), /Second-round worry/)
})
