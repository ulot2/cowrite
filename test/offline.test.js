import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

// Waits until cond() is true. Fails after 5 seconds.
const until = (cond, what) => new Promise((resolve, reject) => {
  const t0 = Date.now()
  const tick = () => cond() ? resolve() : Date.now() - t0 > 5000 ? reject(new Error('timed out: ' + what)) : setTimeout(tick, 20)
  tick()
})

const freePort = () => new Promise(resolve => {
  const s = createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)) })
})

// One `wrangler dev` (the local Cloudflare runtime) for the whole file.
let url, proc
before(async () => {
  const port = await freePort()
  proc = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--port', String(port), '--inspector-port', String(await freePort())], { stdio: ['ignore', 'pipe', 'inherit'] })
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (d.toString().includes('Ready on')) resolve() })
    proc.on('exit', (code) => reject(new Error('wrangler dev exited with ' + code)))
    setTimeout(() => reject(new Error('wrangler dev did not start in 60 s')), 60000).unref()
  })
  url = `ws://localhost:${port}`
})
after(() => {
  // On Windows, kill the whole tree, or the runtime keeps running after node exits.
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'])
  else proc.kill()
})

// A "tab": one doc and one connection to a room. No BroadcastChannel, so the only path is the server.
const openTab = (room) => {
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(url, room, doc, { disableBc: true })
  return { doc, text: doc.getText('content'), provider, close: () => { provider.destroy(); doc.destroy() } }
}
// Storage survives between runs, so every run gets a room of its own.
const freshRoom = () => 'test-' + Date.now() + '-' + Math.random().toString(36).slice(2)

test('a tab that goes offline, edits, and returns ends with the same text as the other tab', async () => {
  const room = freshRoom()
  const a = openTab(room)
  const b = openTab(room)
  a.text.insert(0, 'hello')
  await until(() => b.text.toString() === 'hello', 'b receives hello')

  // b goes offline. Both tabs keep typing.
  b.provider.disconnect()
  a.text.insert(5, ' world')
  b.text.insert(0, 'OFFLINE ')
  assert.equal(a.text.toString(), 'hello world')
  assert.equal(b.text.toString(), 'OFFLINE hello')

  // b returns. Both edits survive, in both tabs, in the same order.
  b.provider.connect()
  const merged = 'OFFLINE hello world'
  await until(() => a.text.toString() === merged && b.text.toString() === merged, 'both tabs merge')

  a.close(); b.close()
})

test('two offline tabs that insert at the same spot agree on one order when they return', async () => {
  const room = freshRoom()
  const a = openTab(room)
  const b = openTab(room)
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

test('the document survives a fresh connection after all tabs closed', async () => {
  const room = freshRoom()
  const a = openTab(room)
  a.text.insert(0, 'kept')
  await until(() => a.provider.synced, 'a synced')
  await new Promise(r => setTimeout(r, 200)) // let the update reach storage
  a.close()

  const b = openTab(room)
  await until(() => b.text.toString() === 'kept', 'b loads the stored text')
  b.close()
})
