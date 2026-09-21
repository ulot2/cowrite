import { DurableObject } from 'cloudflare:workers'
import * as Y from 'yjs'
import * as sync from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { touchEvent } from '~/lib/events.server'

// Message types of the y-websocket protocol. The first byte of every message.
const SYNC = 0
const AWARENESS = 1
// Rows in the update log before we fold them into one row.
const COMPACT_AT = 200
// An automatic version at most this often, and how many unnamed ones we keep.
const AUTO_VERSION_EVERY = 30 * 60 * 1000
const AUTO_VERSIONS_KEPT = 50

type AwarenessChange = { added: number[]; updated: number[]; removed: number[] }
// What we keep on each socket. Memory is gone after hibernation, the socket and its attachment are not.
type Attachment = { role: string; user: string; owned: number[] }
const attachmentOf = (ws: WebSocket): Attachment => ws.deserializeAttachment() ?? { role: 'viewer', user: '', owned: [] }

export type Version = { id: number; name: string | null; created_by: string | null; created_at: number; bytes: number }
export type Block = { type: string; level: number | null; text: string }

// The editor stores blocks as XML: wrappers around content nodes. Flatten to one row per content node.
const wrappers = new Set(['blockGroup', 'blockContainer', 'columnList', 'column'])
const blocksOf = (doc: Y.Doc): Block[] => {
  const out: Block[] = []
  const walk = (node: Y.XmlElement | Y.XmlText | Y.XmlHook) => {
    if (!(node instanceof Y.XmlElement)) return
    if (wrappers.has(node.nodeName)) node.forEach(walk)
    else out.push({ type: node.nodeName, level: Number(node.getAttribute('level')) || null, text: node.toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() })
  }
  doc.getXmlFragment('document-store').forEach(walk)
  return out
}

// One Doc per room. It holds the Y.Doc, stores every update, and forwards messages between sockets.
// Cloudflare runs one copy of it, so all edits for a room pass through one place, in order.
export class Doc extends DurableObject<Env> {
  doc = new Y.Doc()
  awareness = new awarenessProtocol.Awareness(this.doc)
  rows = 0
  // Users who changed the document since the last alarm. In memory: a hibernation inside the
  // 3 s window loses one "edited" event, nothing else. (ponytail: storage.put per edit is not worth it)
  touched = new Set<string>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY, data BLOB NOT NULL)')
    // A version is the whole document at one moment. `name` is NULL for automatic ones.
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS versions (id INTEGER PRIMARY KEY, name TEXT, created_by TEXT, created_at INTEGER NOT NULL, snapshot BLOB NOT NULL)')
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
      // This event fires only for a real change, so the sender counts as an editor.
      const ws = origin as WebSocket | null
      if (ws && typeof ws.deserializeAttachment === 'function') this.touched.add(attachmentOf(ws).user)
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

  // Runs once, 3 s after a change. The object's name is the document id, or "<id>:threads" for the
  // comments room. Each room writes its own column, so a comment never bumps the edit time of the text.
  async alarm() {
    const name = this.ctx.id.name ?? ''
    const editors = [...this.touched].filter(Boolean)
    this.touched.clear()
    if (name.endsWith(':threads')) {
      const id = name.slice(0, -8)
      // One Y.Map per thread with a `resolved` flag.
      const open = [...this.doc.getMap<Y.Map<unknown>>('threads').values()].filter((t) => t.get('resolved') !== true).length
      await this.env.DB.prepare('UPDATE documents SET open_comments = ? WHERE id = ?').bind(open, id).run()
      for (const user of editors) await touchEvent(id, user, 'commented', 'commented')
      return
    }
    // The editor stores blocks as XML in this fragment. Strip the tags, keep the words.
    const preview = this.doc.getXmlFragment('document-store').toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
    await this.env.DB.prepare('UPDATE documents SET preview = ?, updated_at = ? WHERE id = ?').bind(preview, Date.now(), name).run()
    // A baseline after the first edit, then at most one automatic version per half hour of work.
    const last = this.ctx.storage.sql.exec<{ at: number | null }>('SELECT MAX(created_at) AS at FROM versions').one().at
    if (!last || Date.now() - last > AUTO_VERSION_EVERY) this.snapshot(null, null)
    for (const user of editors) await touchEvent(name, user, 'edited', 'edited the text')
  }

  // Replace the log with one row that holds the whole document. Runs without an await, so
  // Cloudflare writes the delete and the insert as one atomic change.
  compact() {
    this.ctx.storage.sql.exec('DELETE FROM updates')
    this.ctx.storage.sql.exec('INSERT INTO updates (data) VALUES (?)', Y.encodeStateAsUpdate(this.doc))
    this.rows = 1
  }

  // Stores the document as it is now. Unnamed versions are automatic; only the newest 50 stay.
  snapshot(name: string | null, userId: string | null) {
    this.ctx.storage.sql.exec('INSERT INTO versions (name, created_by, created_at, snapshot) VALUES (?, ?, ?, ?)', name, userId, Date.now(), Y.encodeStateAsUpdate(this.doc))
    this.ctx.storage.sql.exec(`DELETE FROM versions WHERE name IS NULL AND id NOT IN (SELECT id FROM versions WHERE name IS NULL ORDER BY id DESC LIMIT ${AUTO_VERSIONS_KEPT})`)
    return this.ctx.storage.sql.exec<{ id: number }>('SELECT MAX(id) AS id FROM versions').one().id
  }

  // A separate Y.Doc built from one stored version, or null when the id is unknown.
  docFrom(id: number) {
    const row = this.ctx.storage.sql.exec<{ snapshot: ArrayBuffer }>('SELECT snapshot FROM versions WHERE id = ?', id).toArray()[0]
    if (!row) return null
    const doc = new Y.Doc()
    Y.applyUpdate(doc, new Uint8Array(row.snapshot))
    return doc
  }

  // The methods below are called by the Worker over RPC (env.DOC.get(id).listVersions()).
  // They run inside the object, in order with the socket messages, so they see a consistent document.
  listVersions(): Version[] {
    return this.ctx.storage.sql.exec<Version>('SELECT id, name, created_by, created_at, length(snapshot) AS bytes FROM versions ORDER BY id DESC').toArray()
  }

  readVersion(id: number | 'now'): Block[] | null {
    const doc = id === 'now' ? this.doc : this.docFrom(id)
    return doc && blocksOf(doc)
  }

  saveVersion(name: string, userId: string) {
    return this.snapshot(name, userId)
  }

  // Copies the blocks of an old version over the live ones, in one transaction. It travels the normal
  // update path (stored, broadcast), so every open editor changes in place. The state before the
  // restore is saved first, so a restore can be undone with another restore.
  restoreVersion(id: number) {
    const old = this.docFrom(id)
    if (!old) return false
    this.snapshot(null, null)
    const src = old.getXmlFragment('document-store')
    const dst = this.doc.getXmlFragment('document-store')
    this.doc.transact(() => {
      dst.delete(0, dst.length)
      dst.insert(0, src.toArray().map((node) => node.clone()) as (Y.XmlElement | Y.XmlText)[])
    }, 'restore')
    return true
  }

  // The document was deleted: close everyone, forget the alarm, drop every table.
  async wipe() {
    for (const ws of this.ctx.getWebSockets()) ws.close(1000, 'deleted')
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
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
    server.serializeAttachment({ role: request.headers.get('X-Role') ?? 'viewer', user: request.headers.get('X-User') ?? '', owned: [] } satisfies Attachment)

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
