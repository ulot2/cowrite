import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { DefaultThreadStoreAuth } from '@blocknote/core/comments'
import { YjsThreadStore } from '@blocknote/core/yjs'
import { startApp, until } from './harness.js'

// Polls an async condition, up to `ms`.
const waitFor = async (cond, what, ms = 10000) => {
  for (const t0 = Date.now(); !(await cond());) {
    if (Date.now() - t0 > ms) throw new Error('timed out: ' + what)
    await new Promise((r) => setTimeout(r, 100))
  }
}

// The harness starts the app with AI_FAKE, so the "model" answers "AI <command>: <input length>".
let app, ada, bea, cy, adaId, docId
before(async () => {
  app = await startApp()
  ada = await app.signUpUser('Ada')
  bea = await app.signUpUser('Bea')
  cy = await app.signUpUser('Cy')
  adaId = (await (await fetch(`${app.base}/api/auth/get-session`, { headers: { cookie: ada.cookie } })).json()).user.id
  docId = await app.createDocument(ada.cookie, 'Plan')
  await app.post(`/doc/${docId}`, ada.cookie, { intent: 'add', email: bea.email, role: 'viewer' })
})
after(() => app.stop())

const ask = (cookie, body) => fetch(`${app.base}/api/ai`, { method: 'POST', headers: { cookie: cookie ?? '', 'content-type': 'application/json' }, body: JSON.stringify({ documentId: docId, ...body }), redirect: 'manual' })

test('only people who can suggest may ask the AI, and a rewrite answers with text', async () => {
  assert.equal((await ask(null, { command: 'shorten', text: 'Hello' })).status, 302, 'no session: to the login page')
  assert.equal((await ask(bea.cookie, { command: 'shorten', text: 'Hello' })).status, 403, 'a viewer')
  assert.equal((await ask(cy.cookie, { command: 'shorten', text: 'Hello' })).status, 404, 'a stranger')
  const res = await ask(ada.cookie, { command: 'shorten', text: 'Hello world' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { text: 'AI shorten: 11' })
})

test('an unknown command, an empty selection, and an empty document are refused', async () => {
  assert.equal((await ask(ada.cookie, { command: 'reply', text: 'x' })).status, 400)
  assert.equal((await ask(ada.cookie, { command: 'improve', text: '  ' })).status, 400)
  assert.equal((await ask(ada.cookie, { command: 'summarize' })).status, 400)
})

test('a free instruction needs words, applies to a selection, and caps its length', async () => {
  assert.equal((await ask(ada.cookie, { command: 'custom', instruction: '  ', text: 'Hello' })).status, 400, 'no instruction')
  assert.equal((await ask(ada.cookie, { command: 'custom', instruction: 'x'.repeat(501), text: 'Hello' })).status, 400, 'too long')
  const res = await ask(ada.cookie, { command: 'custom', instruction: 'make it French', text: 'Hello' })
  assert.deepEqual(await res.json(), { text: 'AI custom: 5' })
  assert.equal((await ask(bea.cookie, { command: 'custom', instruction: 'make it French', text: 'Hello' })).status, 403, 'a viewer')
})

test('whole-document commands read the text from the document', async () => {
  const tab = app.openTab(docId, ada.cookie)
  await until(() => tab.provider.synced, 'synced')
  const Y = await import('yjs')
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText('Ship on Friday')])
  tab.doc.getXmlFragment('document-store').push([p])
  await waitFor(async () => (await ask(ada.cookie, { command: 'summarize' })).status === 200, 'the text reaches the object')
  assert.match((await (await ask(ada.cookie, { command: 'summarize' })).json()).text, /^AI summarize: \d+$/)
  tab.close()
})

test('@Nib in a comment gets a reply by Nib in the same thread', async () => {
  const tab = app.openTab(docId, ada.cookie, 'threads')
  const store = new YjsThreadStore(adaId, tab.doc.getMap('threads'), new DefaultThreadStoreAuth(adaId, 'editor'))
  const body = [{ type: 'paragraph', content: [{ type: 'mention', props: { user: 'ai', name: 'Nib' } }, { type: 'text', text: ' what is missing?', styles: {} }] }]
  const thread = await store.createThread({ initialComment: { body } })
  const comments = () => tab.doc.getMap('threads').get(thread.id).get('comments').toArray()
  await waitFor(() => comments().length === 2, 'the reply arrives')
  assert.equal(comments()[1].get('userId'), 'ai')
  assert.match(comments()[1].get('body')[0].content[0].text, /^AI reply: /)
  tab.close()
})
