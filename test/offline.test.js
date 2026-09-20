import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { start } from '../server/index.js'

// Waits until cond() is true. Fails after 5 seconds.
const until = (cond, what) => new Promise((resolve, reject) => {
  const t0 = Date.now()
  const tick = () => cond() ? resolve() : Date.now() - t0 > 5000 ? reject(new Error('timed out: ' + what)) : setTimeout(tick, 20)
  tick()
})

// A "tab": one doc and one connection to the server. No BroadcastChannel, so the only path is the server.
const openTab = (url) => {
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(url, 'main', doc, { disableBc: true })
  return { doc, text: doc.getText('content'), provider, close: () => { provider.destroy(); doc.destroy() } }
}

const withServer = async (fn) => {
  const server = start(0)
  await new Promise(resolve => server.on('listening', resolve))
  try { await fn(`ws://localhost:${server.address().port}`) } finally { server.close() }
}

test('a tab that goes offline, edits, and returns ends with the same text as the other tab', () => withServer(async (url) => {
  const a = openTab(url)
  const b = openTab(url)
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
}))

test('two offline tabs that insert at the same spot agree on one order when they return', () => withServer(async (url) => {
  const a = openTab(url)
  const b = openTab(url)
  a.text.insert(0, '-')
  await until(() => b.text.toString() === '-', 'b receives the dash')

  a.provider.disconnect(); b.provider.disconnect()
  a.text.insert(0, 'A')
  b.text.insert(0, 'B')
  a.provider.connect(); b.provider.connect()

  await until(() => a.text.toString().length === 3 && a.text.toString() === b.text.toString(), 'both tabs agree')
  assert.match(a.text.toString(), /^(AB|BA)-$/)

  a.close(); b.close()
}))
