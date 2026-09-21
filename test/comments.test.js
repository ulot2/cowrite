import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { DefaultThreadStoreAuth } from '@blocknote/core/comments'
import { YjsThreadStore } from '@blocknote/core/yjs'
import { startApp, until } from './harness.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const comment = (text) => ({ body: [{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }] })

let app, ada, adaId, docId
before(async () => {
  app = await startApp()
  ada = await app.signUp('Ada')
  adaId = (await (await fetch(`${app.base}/api/auth/get-session`, { headers: { cookie: ada } })).json()).user.id
  docId = await app.createDocument(ada, 'Commented')
})
after(() => app.stop())

// The same store the editor uses, on a threads-room tab. Threads are a Y.Map in the document's comments room.
const storeFor = (tab) => new YjsThreadStore(adaId, tab.doc.getMap('threads'), new DefaultThreadStoreAuth(adaId, 'editor'))

test('a thread made in one tab appears in the other, and a resolve travels back', async () => {
  const a = app.openTab(docId, ada, 'threads')
  const b = app.openTab(docId, ada, 'threads')
  const thread = await storeFor(a).createThread({ initialComment: comment('Is Friday realistic?') })
  await until(() => b.doc.getMap('threads').has(thread.id), 'b receives the thread')
  assert.equal(b.doc.getMap('threads').get(thread.id).get('resolved'), false)

  await storeFor(b).resolveThread({ threadId: thread.id })
  await until(() => a.doc.getMap('threads').get(thread.id).get('resolved') === true, 'a sees the resolve')
  a.close(); b.close()
})

test('the document card counts open comments, written by the object after the change', async () => {
  const id = await app.createDocument(ada, 'Counted')
  const a = app.openTab(id, ada, 'threads')
  const store = storeFor(a)
  const thread = await store.createThread({ initialComment: comment('One open thread') })
  await sleep(3800) // the object writes to D1 three seconds after an edit
  let html = await (await fetch(`${app.base}/documents`, { headers: { cookie: ada } })).text()
  assert.match(html, /1 open comment/)

  await store.resolveThread({ threadId: thread.id })
  await sleep(3800)
  html = await (await fetch(`${app.base}/documents`, { headers: { cookie: ada } })).text()
  assert.doesNotMatch(html, /open comment/)
  a.close()
})

test('the users route needs a session and returns names for the comment authors', async () => {
  assert.equal((await fetch(`${app.base}/api/users?ids=${adaId}`)).status, 401)
  const users = await (await fetch(`${app.base}/api/users?ids=${adaId}`, { headers: { cookie: ada } })).json()
  assert.deepEqual(users, [{ id: adaId, username: 'Ada', avatarUrl: '' }])
})
