import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startApp } from './harness.js'

let app, ada, bea
before(async () => {
  app = await startApp()
  ada = await app.signUpUser('Ada')
  bea = await app.signUpUser('Bea')
})
after(() => app.stop())

// Settings posts go through Better Auth for the account parts, which checks the origin like a browser.
const save = (cookie, fields) => fetch(`${app.base}/settings`, { method: 'POST', body: new URLSearchParams(fields), headers: { cookie, origin: app.base }, redirect: 'manual' })
// The action's answer, as the page's fetchers get it (React Router's .data encoding): search it for "ok" or the error.
const said = async (cookie, fields) => (await (await fetch(`${app.base}/settings.data`, { method: 'POST', body: new URLSearchParams(fields), headers: { cookie, origin: app.base }, redirect: 'manual' })).text())
const page = async (path, cookie) => (await fetch(app.base + path, { headers: { cookie } })).text()

test('the name and photo change for everyone; a photo must be one this app stored', async () => {
  assert.doesNotMatch(await said(ada.cookie, { intent: 'name', name: '  ' }), /"ok"/)
  await said(ada.cookie, { intent: 'name', name: 'Ada Lovelace' })
  assert.match(await page('/settings', ada.cookie), /Ada Lovelace/)
  assert.match(await said(ada.cookie, { intent: 'photo', image: 'https://evil.example/x.png' }), /did not upload/)
  await said(ada.cookie, { intent: 'photo', image: '/files/abc-123/me.png' })
  assert.match(await page('/', ada.cookie), /src="\/files\/abc-123\/me.png"/)
})

test('muted kinds stay out of the bell and its count', async () => {
  const id = await app.createDocument(bea.cookie, 'Plan')
  await app.post(`/doc/${id}`, bea.cookie, { intent: 'add', email: ada.email, role: 'editor' })
  await said(ada.cookie, { intent: 'notifications', kind: 'sharing' }) // everything but sharing is muted
  await app.post(`/doc/${id}`, bea.cookie, { intent: 'rename', title: 'Plan B' })
  const inbox = await (await fetch(`${app.base}/api/inbox`, { headers: { cookie: ada.cookie } })).json()
  assert.ok(inbox.events.some((e) => e.type === 'shared'), 'sharing still arrives')
  assert.ok(!inbox.events.some((e) => e.type === 'renamed'), 'the rename is muted')
  assert.equal(inbox.unseen, inbox.events.length)
})

test('with Nib off, the AI route refuses; on again, it answers', async () => {
  const id = await app.createDocument(ada.cookie, 'Notes')
  const ask = () => fetch(`${app.base}/api/ai`, { method: 'POST', headers: { cookie: ada.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ documentId: id, command: 'shorten', text: 'Hello there' }) })
  await said(ada.cookie, { intent: 'nib' }) // an unchecked switch sends nothing
  assert.equal((await ask()).status, 403)
  await said(ada.cookie, { intent: 'nib', nib: 'on' })
  assert.equal((await ask()).status, 200)
})

test('a password change needs the current password, and the new one signs in', async () => {
  assert.match(await said(ada.cookie, { intent: 'password', has: '1', current: 'wrong-password', new: 'a-new-password', confirm: 'a-new-password' }), /error/i)
  assert.match(await said(ada.cookie, { intent: 'password', has: '1', current: 'a-test-password', new: 'short', confirm: 'short' }), /8 to 128/)
  assert.match(await said(ada.cookie, { intent: 'password', has: '1', current: 'a-test-password', new: 'a-new-password', confirm: 'a-new-password' }), /"ok"/)
  const signIn = (password) => fetch(`${app.base}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: app.base }, body: JSON.stringify({ email: ada.email, password }) })
  assert.equal((await signIn('a-test-password')).status, 401)
  assert.equal((await signIn('a-new-password')).status, 200)
})

test('deleting the account needs the email typed, then takes the owned documents and signs out', async () => {
  const id = await app.createDocument(ada.cookie, 'Mine')
  await app.post(`/doc/${id}`, ada.cookie, { intent: 'add', email: bea.email, role: 'viewer' })
  assert.equal((await fetch(`${app.base}/doc/${id}`, { headers: { cookie: bea.cookie } })).status, 200)
  assert.match(await said(ada.cookie, { intent: 'delete-account', email: 'someone@else.test' }), /Type your email/)
  const res = await save(ada.cookie, { intent: 'delete-account', email: ada.email.toUpperCase() })
  assert.ok([302, 204].includes(res.status), `redirected (${res.status})`)
  assert.equal((await fetch(`${app.base}/doc/${id}`, { headers: { cookie: bea.cookie } })).status, 404, 'the document went with the account')
  assert.equal((await fetch(`${app.base}/`, { headers: { cookie: ada.cookie }, redirect: 'manual' })).status, 302, 'signed out')
})
