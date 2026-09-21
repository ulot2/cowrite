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
export const until = (cond, what) => new Promise((resolve, reject) => {
  const t0 = Date.now()
  const tick = () => cond() ? resolve() : Date.now() - t0 > 5000 ? reject(new Error('timed out: ' + what)) : setTimeout(tick, 20)
  tick()
})

const freePort = () => new Promise(resolve => {
  const s = createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)) })
})

const wrangler = (args) => spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { stdio: ['ignore', 'pipe', 'inherit'] })

// Starts the built Worker on the local Cloudflare runtime with a database of its own.
// Returns the base URL and helpers bound to it. `npm test` builds first.
export const startApp = async () => {
  const persist = mkdtempSync(join(tmpdir(), 'cowrite-test-'))
  const migrate = wrangler(['d1', 'migrations', 'apply', 'cowrite', '--local', '--persist-to', persist])
  await new Promise((resolve, reject) => migrate.on('exit', (code) => code === 0 ? resolve() : reject(new Error('migrations failed'))))

  const port = await freePort()
  const base = `http://localhost:${port}`
  const proc = wrangler(['dev', '--port', String(port), '--inspector-port', String(await freePort()), '--persist-to', persist,
    '--var', 'BETTER_AUTH_SECRET:test-secret-test-secret-test-secret', '--var', `BETTER_AUTH_URL:${base}`])
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (d.toString().includes('Ready on')) resolve() })
    proc.on('exit', (code) => reject(new Error('wrangler dev exited with ' + code)))
    setTimeout(() => reject(new Error('wrangler dev did not start in 60 s')), 60000).unref()
  })

  // Signs up a user through the real auth API. Returns the session cookie.
  const signUp = async (name) => {
    const res = await fetch(`${base}/api/auth/sign-up/email`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ name, email: `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: 'a-test-password' }),
    })
    assert.equal(res.status, 200, 'sign-up ' + name)
    return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  }

  // Creates a document through the home page's action. Returns its id from the redirect.
  const createDocument = async (cookie, title) => {
    const body = new URLSearchParams({ intent: 'create', title })
    const res = await fetch(`${base}/?index`, { method: 'POST', body, headers: { cookie }, redirect: 'manual' }) // ?index: the home page is an index route
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

  // Tries the WebSocket handshake and returns the HTTP status the server answered with.
  const handshakeStatus = (documentId, cookie) => new Promise((resolve) => {
    const ws = new NodeWebSocket(`${base.replace('http', 'ws')}/ws/${documentId}`, { headers: cookie ? { cookie } : {} })
    ws.on('unexpected-response', (_req, res) => { resolve(res.statusCode); ws.terminate() })
    ws.on('open', () => { resolve(101); ws.close() })
    ws.on('error', () => {})
  })

  const stop = () => {
    // On Windows, kill the whole tree, or the runtime keeps running after node exits.
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
    else proc.kill()
    try { rmSync(persist, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) } catch { /* Windows keeps a file open a little longer; the temp folder is harmless */ }
  }

  return { base, signUp, createDocument, openTab, handshakeStatus, stop }
}
