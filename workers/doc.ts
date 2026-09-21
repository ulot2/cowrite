import { DurableObject } from 'cloudflare:workers'
import * as Y from 'yjs'
import * as sync from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

// Message types of the y-websocket protocol. The first byte of every message.
const SYNC = 0
const AWARENESS = 1
// Rows in the update log before we fold them into one row.
const COMPACT_AT = 200

type AwarenessChange = { added: number[]; updated: number[]; removed: number[] }
// What we keep on each socket. Memory is gone after hibernation, the socket and its attachment are not.
type Attachment = { role: string; owned: number[] }
const attachmentOf = (ws: WebSocket): Attachment => ws.deserializeAttachment() ?? { role: 'viewer', owned: [] }

// One Doc per room. It holds the Y.Doc, stores every update, and forwards messages between sockets.
// Cloudflare runs one copy of it, so all edits for a room pass through one place, in order.
export class Doc extends DurableObject<Env> {
  doc = new Y.Doc()
  awareness = new awarenessProtocol.Awareness(this.doc)
  rows = 0

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY, data BLOB NOT NULL)')
    // Rebuild the document from the log. This runs on every wake, also after hibernation.
    for (const row of this.ctx.storage.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM updates ORDER BY id')) {
      Y.applyUpdate(this.doc, new Uint8Array(row.data))
      this.rows++
    }
    this.awareness.setLocalState(null) // the server is not a user
    // Awareness starts a timer to expire stale clients. A timer keeps the object awake, and we
    // remove clients on socket close anyway, so drop it. (ponytail: private field of y-protocols)
    clearInterval((this.awareness as unknown as { _checkInterval: number })._checkInterval)

    // A doc change from one client is stored, then goes to every other client.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.ctx.storage.sql.exec('INSERT INTO updates (data) VALUES (?)', update)
      if (++this.rows >= COMPACT_AT) this.compact()
      // A few seconds after the last edit, alarm() writes the preview and the edit time to D1.
      this.ctx.storage.getAlarm().then((at) => { if (at === null) this.ctx.storage.setAlarm(Date.now() + 3000) })
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, SYNC)
      sync.writeUpdate(enc, update)
      this.broadcast(encoding.toUint8Array(enc), origin)
    })

    // A presence change (cursor, name) goes to every client, including the sender.
    this.awareness.on('update', ({ added, updated, removed }: AwarenessChange, origin: unknown) => {
      const ws = origin as WebSocket | null
      if (ws && typeof ws.serializeAttachment === 'function') {
        // Remember which awareness ids this socket introduced. Only `added` counts: clients echo
        // every change they hear, so `updated` would make every socket own everyone.
        const attachment = attachmentOf(ws)
        const owned = new Set(attachment.owned)
        for (const id of added) owned.add(id)
        for (const id of removed) owned.delete(id)
        ws.serializeAttachment({ ...attachment, owned: [...owned] })
      }
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, AWARENESS)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]))
      this.broadcast(encoding.toUint8Array(enc), null)
    })
  }

  // Runs once, 3 s after an edit. The object's name is the document id.
  async alarm() {
    // The editor stores blocks as XML in this fragment. Strip the tags, keep the words.
    const preview = this.doc.getXmlFragment('document-store').toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
    // Comment threads live in the 'threads' map, one Y.Map per thread with a `resolved` flag.
    const open = [...this.doc.getMap<Y.Map<unknown>>('threads').values()].filter((t) => t.get('resolved') !== true).length
    await this.env.DB.prepare('UPDATE documents SET preview = ?, open_comments = ?, updated_at = ? WHERE id = ?').bind(preview, open, Date.now(), this.ctx.id.name ?? '').run()
  }

  // Replace the log with one row that holds the whole document. Runs without an await, so
  // Cloudflare writes the delete and the insert as one atomic change.
  compact() {
    this.ctx.storage.sql.exec('DELETE FROM updates')
    this.ctx.storage.sql.exec('INSERT INTO updates (data) VALUES (?)', Y.encodeStateAsUpdate(this.doc))
    this.rows = 1
  }

  broadcast(msg: Uint8Array, except: unknown) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue
      try { ws.send(msg) } catch { /* socket already closed; webSocketClose cleans it up */ }
    }
  }

  async fetch(request: Request): Promise<Response> {
    // Plain HTTP gets a short text answer, so a health check or a browser visit sees 200.
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response(`cowrite sync server. ${this.ctx.getWebSockets().length} connected, ${this.awareness.getStates().size} present. Connect with a WebSocket.`)
    }

    const [client, server] = Object.values(new WebSocketPair())
    // Hibernation API: Cloudflare keeps the socket open even while this object sleeps,
    // and wakes it with webSocketMessage / webSocketClose when something arrives.
    this.ctx.acceptWebSocket(server)
    // The Worker checked the session and the role before it forwarded the request.
    server.serializeAttachment({ role: request.headers.get('X-Role') ?? 'viewer', owned: [] } satisfies Attachment)

    // Handshake: ask the new client what it has (step 1). It answers with step 2 and its own step 1.
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, SYNC)
    sync.writeSyncStep1(enc, this.doc)
    server.send(encoding.toUint8Array(enc))

    // Tell the new client who is already here. First drop anyone silent for 30 s (clients renew
    // every 15 s), which replaces the timer we removed in the constructor.
    const stale = [...this.awareness.meta].filter(([, m]) => Date.now() - m.lastUpdated > 30000).map(([id]) => id)
    if (stale.length) awarenessProtocol.removeAwarenessStates(this.awareness, stale, null)
    const ids = [...this.awareness.getStates().keys()]
    if (ids.length) {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, AWARENESS)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids))
      server.send(encoding.toUint8Array(enc))
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(ws: WebSocket, data: ArrayBuffer | string) {
    if (typeof data === 'string') return // the protocol is binary only
    const dec = decoding.createDecoder(new Uint8Array(data))
    switch (decoding.readVarUint(dec)) {
      case SYNC: {
        // A viewer may ask for the document (step 1) but never change it (step 2 or an update).
        if (attachmentOf(ws).role === 'viewer' && decoding.peekVarUint(dec) !== sync.messageYjsSyncStep1) return
        // readSyncMessage answers step 1 with step 2, and applies step 2 and updates to the doc.
        const enc = encoding.createEncoder()
        encoding.writeVarUint(enc, SYNC)
        sync.readSyncMessage(dec, enc, this.doc, ws)
        if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc))
        break
      }
      case AWARENESS:
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), ws)
        break
    }
  }

  // When a tab closes, its cursor and name leave the other tabs.
  webSocketClose(ws: WebSocket) {
    awarenessProtocol.removeAwarenessStates(this.awareness, attachmentOf(ws).owned, null)
  }

  webSocketError(ws: WebSocket) {
    this.webSocketClose(ws)
  }
}

