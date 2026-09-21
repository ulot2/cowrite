import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startApp, until } from './harness.js'

let app, ada, docId
before(async () => {
  app = await startApp()
  ada = await app.signUp('Ada')
  docId = await app.createDocument(ada, 'Test document')
})
after(() => app.stop())

test('a tab that goes offline, edits, and returns ends with the same text as the other tab', async () => {
  const a = app.openTab(docId, ada)
  const b = app.openTab(docId, ada)
  a.text.insert(0, 'hello')
  await until(() => b.text.toString() === 'hello', 'b receives hello')

  b.provider.disconnect()
  a.text.insert(5, ' world')
  b.text.insert(0, 'OFFLINE ')
  assert.equal(a.text.toString(), 'hello world')
  assert.equal(b.text.toString(), 'OFFLINE hello')

  b.provider.connect()
  const merged = 'OFFLINE hello world'
  await until(() => a.text.toString() === merged && b.text.toString() === merged, 'both tabs merge')
  a.close(); b.close()
})

test('two offline tabs that insert at the same spot agree on one order when they return', async () => {
  const id = await app.createDocument(ada, 'Concurrent')
  const a = app.openTab(id, ada)
  const b = app.openTab(id, ada)
  a.text.insert(0, '-')
  await until(() => b.text.toString() === '-', 'b receives the dash')

  a.provider.disconnect(); b.provider.disconnect()
  a.text.insert(0, 'A')
  b.text.insert(0, 'B')
  a.provider.connect(); b.provider.connect()

  await until(() => a.text.toString().length === 3 && a.text.toString() === b.text.toString(), 'both tabs agree')
  assert.match(a.text.toString(), /^(AB|BA)-$/)
  a.close(); b.close()
})

test("a tab that closes disappears from the other tab's presence list", async () => {
  const a = app.openTab(docId, ada)
  const b = app.openTab(docId, ada)
  a.provider.awareness.setLocalStateField('user', { name: 'Ada' })
  b.provider.awareness.setLocalStateField('user', { name: 'Ada again' })
  await until(() => b.provider.awareness.getStates().size === 2, 'b sees both')
  a.close()
  await until(() => b.provider.awareness.getStates().size === 1, 'the server removed a on close')
  b.close()
})

test('the document survives a fresh connection after all tabs closed', async () => {
  const id = await app.createDocument(ada, 'Kept')
  const a = app.openTab(id, ada)
  a.text.insert(0, 'kept')
  await until(() => a.provider.synced, 'a synced')
  await new Promise(r => setTimeout(r, 200))
  a.close()
  const b = app.openTab(id, ada)
  await until(() => b.text.toString() === 'kept', 'b loads the stored text')
  b.close()
})

test('a socket without a session is refused, and one for a document you cannot open too', async () => {
  assert.equal(await app.handshakeStatus(docId, null), 401)
  const grace = await app.signUp('Grace')
  assert.equal(await app.handshakeStatus(docId, grace), 403)
  assert.equal(await app.handshakeStatus(docId, ada), 101)
})

test('an image upload needs a session, and the file comes back byte for byte', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex') // the start of a PNG, enough for this test
  const headers = { 'content-type': 'image/png', 'x-file-name': 'dot.png' }
  const anonymous = await fetch(`${app.base}/upload`, { method: 'POST', body: png, headers })
  assert.equal(anonymous.status, 401)

  const upload = await fetch(`${app.base}/upload`, { method: 'POST', body: png, headers: { ...headers, cookie: ada } })
  assert.equal(upload.status, 200)
  const { url } = await upload.json()
  assert.match(url, /^\/files\/[0-9a-f-]{36}\/dot\.png$/)

  const served = await fetch(app.base + url)
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), png)
})
