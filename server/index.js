import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import * as sync from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { fileURLToPath } from 'node:url'

// Message types of the y-websocket protocol. The first byte of every message.
const SYNC = 0
const AWARENESS = 1

// Starts one room on one port. Port 0 picks a free port (the tests use that).
export const start = (port) => {
  // One document, one room. It lives in memory for the life of the process.
  // ponytail: no persistence; a restart empties the doc. Add a file dump when that matters.
  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)
  awareness.setLocalState(null) // the server is not a user

  const wss = new WebSocketServer({ port })
  const owned = new Map() // socket -> Set of awareness client ids it announced
  wss.on('close', () => awareness.destroy()) // stops the awareness timer, so the process can exit

  const send = (ws, msg) => { if (ws.readyState === ws.OPEN) ws.send(msg) }
  const broadcast = (msg, except) => { for (const c of wss.clients) if (c !== except) send(c, msg) }

  // A doc change from one client goes to every other client.
  doc.on('update', (update, origin) => {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, SYNC)
    sync.writeUpdate(enc, update)
    broadcast(encoding.toUint8Array(enc), origin)
  })

  // A presence change (cursor, name) goes to every client, including the sender.
  awareness.on('update', ({ added, updated, removed }, origin) => {
    if (owned.has(origin)) for (const id of [...added, ...updated]) owned.get(origin).add(id)
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, AWARENESS)
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]))
    broadcast(encoding.toUint8Array(enc), null)
  })

  wss.on('connection', (ws) => {
    ws.binaryType = 'arraybuffer'
    owned.set(ws, new Set())

    ws.on('message', (data) => {
      const dec = decoding.createDecoder(new Uint8Array(data))
      switch (decoding.readVarUint(dec)) {
        case SYNC: {
          // readSyncMessage answers step 1 with step 2, and applies step 2 and updates to the doc.
          const enc = encoding.createEncoder()
          encoding.writeVarUint(enc, SYNC)
          sync.readSyncMessage(dec, enc, doc, ws)
          if (encoding.length(enc) > 1) send(ws, encoding.toUint8Array(enc))
          break
        }
        case AWARENESS:
          awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(dec), ws)
          break
      }
    })

    // When a tab closes, its cursor and name leave the other tabs.
    ws.on('close', () => {
      awarenessProtocol.removeAwarenessStates(awareness, [...owned.get(ws)], null)
      owned.delete(ws)
    })

    // Handshake: ask the new client what it has (step 1). It answers with step 2 and its own step 1.
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, SYNC)
    sync.writeSyncStep1(enc, doc)
    send(ws, encoding.toUint8Array(enc))

    // Tell the new client who is already here.
    const ids = [...awareness.getStates().keys()]
    if (ids.length) {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, AWARENESS)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, ids))
      send(ws, encoding.toUint8Array(enc))
    }
  })

  return wss
}

// Run directly (not imported): listen on $PORT, or 1234.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const wss = start(Number(process.env.PORT) || 1234)
  wss.on('listening', () => console.log(`cowrite server on ws://localhost:${wss.address().port}`))
}
