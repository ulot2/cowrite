import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { WebSocket as NodeWebSocket } from 'ws'

// Waits until cond() is true. Fails after 5 seconds.
const until = (cond, what) => new Promise((resolve, reject) => {
  const t0 = Date.now()
  const tick = () => cond() ? resolve() : Date.now() - t0 > 5000 ? reject(new Error('timed out: ' + what)) : setTimeout(tick, 20)
  tick()
})

const freePort = () => new Promise(resolve => {
  const s = createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)) })
})

const wrangler = (args, opts = {}) => spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { stdio: ['ignore', 'pipe', 'inherit'], ...opts })

// One built Worker and one local Cloudflare runtime for the whole file, with a database of its own.
let base, proc, persist, ada, docId
before(async () => {
  spawnSync('npx', ['react-router', 'build'], { stdio: 'ignore', shell: true })
  persist = mkdtempSync(join(tmpdir(), 'cowrite-test-'))
  const migrate = wrangler(['d1', 'migrations', 'apply', 'cowrite', '--local', '--persist-to', persist])
  await new Promise((resolve, reject) => migrate.on('exit', (code) => code === 0 ? resolve() : reject(new Error('migrations failed'))))

  const port = await freePort()
  base = `http://localhost:${port}`
  proc = wrangler(['dev', '--port', String(port), '--inspector-port', String(await freePort()), '--persist-to', persist,
    '--var', 'BETTER_AUTH_SECRET:test-secret-test-secret-test-secret', '--var', `BETTER_AUTH_URL:${base}`])
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (d.toString().includes('Ready on')) resolve() })
    proc.on('exit', (code) => reject(new Error('wrangler dev exited with ' + code)))
    setTimeout(() => reject(new Error('wrangler dev did not start in 60 s')), 60000).unref()
  })
  ada = await signUp('Ada')
  docId = await createDocument(ada, 'Test document')
})
after(() => {
  // On Windows, kill the whole tree, or the runtime keeps running after node exits.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
  else proc.kill()
  rmSync(persist, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
})

// Signs up a user through the real auth API. Returns the session cookie.
const signUp = async (name) => {
  const res = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ name, email: `${name.toLowerCase()}-${Date.now()}@example.test`, password: 'a-test-password' }),
  })
  assert.equal(res.status, 200, 'sign-up ' + name)
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}

// Creates a document through the list page's action. Returns its id from the redirect.
const createDocument = async (cookie, title) => {
  const body = new URLSearchParams({ intent: 'create', title })
  const res = await fetch(`${base}/?index`, { method: 'POST', body, headers: { cookie }, redirect: 'manual' }) // ?index: the list page is an index route
  assert.equal(res.status, 302, 'create document')
  return res.headers.get('location').split('/').pop()
}

// A "tab": one doc and one connection, signed in as `cookie`. The polyfill adds the cookie the browser would send.
const openTab = (documentId, cookie) => {
  const WebSocketPolyfill = class extends NodeWebSocket { constructor(url) { super(url, { headers: { cookie } }) } }
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(base.replace('http', 'ws') + '/ws', documentId, doc, { disableBc: true, WebSocketPolyfill })
  return { doc, text: doc.getText('content'), provider, close: () => { provider.destroy(); doc.destroy() } }
}

test('a tab that goes offline, edits, and returns ends with the same text as the other tab', async () => {
  const a = openTab(docId, ada)
  const b = openTab(docId, ada)
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
  const id = await createDocument(ada, 'Concurrent')
  const a = openTab(id, ada)
  const b = openTab(id, ada)
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
  const a = openTab(docId, ada)
  const b = openTab(docId, ada)
  a.provider.awareness.setLocalStateField('user', { name: 'Ada' })
  b.provider.awareness.setLocalStateField('user', { name: 'Ada again' })
  await until(() => b.provider.awareness.getStates().size === 2, 'b sees both')
  a.close()
  await until(() => b.provider.awareness.getStates().size === 1, 'the server removed a on close')
  b.close()
})

test('the document survives a fresh connection after all tabs closed', async () => {
  const id = await createDocument(ada, 'Kept')
  const a = openTab(id, ada)
  a.text.insert(0, 'kept')
  await until(() => a.provider.synced, 'a synced')
  await new Promise(r => setTimeout(r, 200))
  a.close()
  const b = openTab(id, ada)
  await until(() => b.text.toString() === 'kept', 'b loads the stored text')
  b.close()
})

// Tries the WebSocket handshake and returns the HTTP status the server answered with.
const handshakeStatus = (documentId, cookie) => new Promise((resolve) => {
  const ws = new NodeWebSocket(`${base.replace('http', 'ws')}/ws/${documentId}`, { headers: cookie ? { cookie } : {} })
  ws.on('unexpected-response', (_req, res) => { resolve(res.statusCode); ws.terminate() })
  ws.on('open', () => { resolve(101); ws.close() })
  ws.on('error', () => {})
})

test('a socket without a session is refused, and one for a document you cannot open too', async () => {
  assert.equal(await handshakeStatus(docId, null), 401)
  const grace = await signUp('Grace')
  assert.equal(await handshakeStatus(docId, grace), 403)
  assert.equal(await handshakeStatus(docId, ada), 101)
})
