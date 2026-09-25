import { DurableObject } from 'cloudflare:workers'
import * as Y from 'yjs'
import * as sync from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { logEvent, logSpaceEvent, touchEvent } from '~/lib/events.server'
import { writeState } from '~/lib/state.server'
import { indexBody, indexComments, indexSpace } from '~/lib/search.server'
import { checkDocument } from '~/lib/nib.server'
import { syncWork, type WorkItem } from '~/lib/work.server'
import { syncDiscussions, type DiscussionItem, type SpaceTaskItem } from '~/lib/discussions.server'
import { ask } from '~/lib/ai.server'
import { inlineText, safeHref, toText, type Block as RichBlock, type Inline } from '~/lib/rich'
import { GUEST_DAYS } from '~/lib/guest.server'

// Message types of the y-websocket protocol. The first byte of every message.
const SYNC = 0
const AWARENESS = 1
// Rows in the update log before we fold them into one row.
const COMPACT_AT = 200
const GUEST_TTL = GUEST_DAYS * 864e5 // a guest document is deleted this long after its last edit
// An automatic version at most this often, and how many unnamed ones we keep.
const AUTO_VERSION_EVERY = 30 * 60 * 1000
const AUTO_VERSIONS_KEPT = 50
// The user id of the AI in comments and suggestions.
const AI = 'ai'

// The words of a comment body (BlockNote blocks), mentions as "@name".
const plainOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(plainOf).join(' ')
  if (!node || typeof node !== 'object') return ''
  const n = node as { text?: string; type?: string; props?: { name?: string }; content?: unknown; children?: unknown }
  if (typeof n.text === 'string') return n.text
  if (n.type === 'mention') return '@' + (n.props?.name ?? '')
  return [plainOf(n.content), plainOf(n.children)].join(' ').trim()
}

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

// The same XML as a tree with formatting, for reading outside the editor. Pending suggestions read
// as rejected: inserted text is left out, deleted text stays. Comment marks are ignored.
const inlineOf = (node: Y.XmlElement): Inline[] => {
  const out: Inline[] = []
  node.forEach((child) => {
    if (!(child instanceof Y.XmlText)) return
    for (const op of child.toDelta() as { insert: unknown; attributes?: Record<string, { href?: string } | undefined> }[]) {
      const a = op.attributes ?? {}
      if (typeof op.insert !== 'string' || a.insertion) continue
      out.push({ text: op.insert, bold: !!a.bold || undefined, italic: !!a.italic || undefined, underline: !!a.underline || undefined, strike: !!a.strike || undefined, code: !!a.code || undefined, href: a.link ? safeHref(a.link.href) : undefined })
    }
  })
  return out
}
const richFrom = (doc: Y.Doc): RichBlock[] => {
  const blocksIn = (parent: Y.XmlFragment | Y.XmlElement): RichBlock[] => {
    const out: RichBlock[] = []
    parent.forEach((node) => {
      if (!(node instanceof Y.XmlElement)) return
      if (node.nodeName === 'blockGroup') return out.push(...blocksIn(node))
      if (node.nodeName === 'blockContainer') {
        const [content, group] = node.toArray().filter((n): n is Y.XmlElement => n instanceof Y.XmlElement)
        if (!content) return
        const block = blockOf(content)
        if (group?.nodeName === 'blockGroup') block.children = blocksIn(group)
        return out.push(block)
      }
      out.push(blockOf(node)) // a content node without a container (older documents, tests)
    })
    return out
  }
  const blockOf = (el: Y.XmlElement): RichBlock => {
    const attr = (k: string) => el.getAttribute(k) as unknown
    const block: RichBlock = { type: el.nodeName, props: {}, content: [], children: [] }
    if (el.nodeName === 'table') {
      // table > tableRow > tableCell | tableHeader > tableParagraph
      block.rows = el.toArray().filter((r): r is Y.XmlElement => r instanceof Y.XmlElement).map((row) =>
        row.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement).map((cell) =>
          cell.toArray().filter((p): p is Y.XmlElement => p instanceof Y.XmlElement).flatMap(inlineOf)))
      return block
    }
    if (attr('level')) block.props.level = Number(attr('level'))
    if (attr('checked') != null) block.props.checked = String(attr('checked')) === 'true'
    if (attr('language')) block.props.language = String(attr('language'))
    if (attr('url')) block.props.url = safeHref(attr('url'))
    if (attr('caption')) block.props.caption = String(attr('caption'))
    for (const k of ['taskId', 'assignee', 'assigneeName', 'due', 'decisionId', 'status'] as const) if (attr(k)) block.props[k] = String(attr(k))
    if (attr('done') != null) block.props.done = String(attr('done')) === 'true'
    if (attr('number')) block.props.number = Number(attr('number'))
    block.content = inlineOf(el)
    return block
  }
  return isBoard(doc) ? boardBlocks(doc) : blocksIn(doc.getXmlFragment('document-store'))
}

// A board keeps columns in `groups` and cards in `cards`. Read as blocks (a heading per column, an item
// per card, task cards as tasks), it exports, prints, publishes, and is searched like a document.
export type Card = { text: string; group: string; pos: number; votes: string[]; doc?: string; task?: { assignee?: string; assigneeName?: string; due?: string; done?: boolean } }
const isBoard = (doc: Y.Doc) => doc.getArray('groups').length > 0
const cardsOf = (doc: Y.Doc) => [...doc.getMap<Y.Map<unknown>>('cards').entries()].map(([id, c]) => ({
  id, text: String(c.get('text') ?? ''), group: String(c.get('group') ?? ''), pos: Number(c.get('pos') ?? 0),
  votes: [...((c.get('votes') as Y.Map<boolean> | undefined)?.keys() ?? [])], task: c.get('task') as Card['task'],
}))
const boardBlocks = (doc: Y.Doc): RichBlock[] => {
  const cards = cardsOf(doc).sort((a, b) => a.pos - b.pos)
  return (doc.getArray('groups').toArray() as { id: string; name: string }[]).flatMap((g) => [
    { type: 'heading', props: { level: 2 }, content: [{ text: g.name }], children: [] },
    ...cards.filter((c) => c.group === g.id).map((c): RichBlock => c.task
      ? { type: 'task', props: { taskId: c.id, ...c.task }, content: [{ text: c.text }], children: [] }
      : { type: 'bulletListItem', props: {}, content: [{ text: c.text + (c.votes.length ? ` (${c.votes.length} ${c.votes.length === 1 ? 'vote' : 'votes'})` : '') }], children: [] }),
  ])
}

// Every task and decision in the tree, nested ones included.
const workOf = (blocks: RichBlock[]): WorkItem[] => blocks.flatMap((b) => [
  ...(b.type === 'task' && b.props.taskId ? [{ kind: 'task' as const, id: b.props.taskId, text: inlineText(b.content), assignee: b.props.assignee || null, assigneeName: b.props.assigneeName ?? '', due: b.props.due || null, done: !!b.props.done }] : []),
  ...(b.type === 'decision' && b.props.decisionId ? [{ kind: 'decision' as const, id: b.props.decisionId, text: inlineText(b.content), status: b.props.status ?? 'proposed', number: b.props.number ?? 0 }] : []),
  ...workOf(b.children),
])

// The XML element of a task or decision block, by its id prop.
const findBlock = (doc: Y.Doc, id: string) => {
  let found: Y.XmlElement | null = null
  const walk = (node: Y.XmlFragment | Y.XmlElement) => node.forEach((n) => {
    if (found || !(n instanceof Y.XmlElement)) return
    if (n.getAttribute('taskId') === id || n.getAttribute('decisionId') === id) found = n
    else walk(n)
  })
  walk(doc.getXmlFragment('document-store'))
  return found as Y.XmlElement | null
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
  // Whether the document changed since the last alarm. True after a wake, when we cannot know,
  // so an alarm that only runs Nib's check skips the edit work (and the edit time) when it can.
  changed = true
  // A document made without an account (see guest.server.ts). It writes only its guest row to D1,
  // and it deletes itself GUEST_DAYS after its last edit. Claiming it on sign-up clears the flag.
  guest = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => { this.guest = (await ctx.storage.get<boolean>('guest')) === true })
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
      this.changed = true
      if (++this.rows >= COMPACT_AT) this.compact()
      // This event fires only for a real change, so the sender counts as an editor.
      const ws = origin as WebSocket | null
      if (ws && typeof ws.deserializeAttachment === 'function') this.touched.add(attachmentOf(ws).user)
      if (this.guest) this.ctx.storage.put('editedAt', Date.now()) // the guest document's clock
      // A few seconds after the last edit, alarm() writes the preview and the edit time to D1.
      // A later alarm (a guest document's expiry) moves up; the alarm sets it again.
      this.ctx.storage.getAlarm().then((at) => { if (at === null || at > Date.now() + 3000) this.ctx.storage.setAlarm(Date.now() + 3000) })
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
    // ponytail: a room from the old playground (before guest documents). It goes when its alarm
    // runs, at the latest 7 days after 2026-09-25; delete these three lines after 2026-10-03.
    if (name.startsWith('play:')) { await this.wipe(); return }
    // A guest document: its preview and edit time go to its guest row, and nothing else to D1.
    // A month after its last edit it deletes itself, row and all.
    if (this.guest) {
      const at = (await this.ctx.storage.get<number>('editedAt')) ?? Date.now()
      if (Date.now() - at >= GUEST_TTL) {
        await this.env.DB.prepare('DELETE FROM guest_documents WHERE id = ?').bind(name).run()
        await this.wipe()
        return
      }
      if (this.changed) {
        this.changed = false
        const preview = this.doc.getXmlFragment('document-store').toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
        await this.env.DB.prepare('UPDATE guest_documents SET preview = ?, updated_at = ? WHERE id = ?').bind(preview, at, name).run()
      }
      await this.ctx.storage.setAlarm(at + GUEST_TTL)
      return
    }
    if (name.endsWith(':space')) {
      // A space's room: discussions (a Y.Map each, with a Y.Array of posts) and the tasks made from posts.
      const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
      const items: DiscussionItem[] = [...this.doc.getMap<Y.Map<unknown>>('discussions').entries()].map(([id, d]) => {
        const posts = (d.get('posts') as Y.Array<Y.Map<unknown>> | undefined)?.toArray() ?? []
        const last = posts[posts.length - 1]
        return {
          id, title: String(d.get('title') ?? '').slice(0, 200) || 'Untitled', kind: d.get('kind') === 'question' ? 'question' : 'talk',
          status: d.get('status') === 'answered' ? 'answered' : d.get('status') === 'closed' ? 'closed' : 'open',
          owner: str(d.get('owner')), due: str(d.get('due')), posts: posts.length,
          lastAt: Number(last?.get('createdAt') ?? d.get('createdAt') ?? Date.now()), lastBy: str(last?.get('userId')),
          createdBy: String(d.get('createdBy') ?? ''), answer: String(d.get('answer') ?? ''), answeredBy: str(d.get('answeredBy')),
          decisionNumber: Number(d.get('decisionNumber') ?? 0),
        }
      })
      const tasks: SpaceTaskItem[] = [...this.doc.getMap<Record<string, unknown>>('tasks').entries()].map(([id, t]) => ({
        id, text: String(t.text ?? '').slice(0, 500), assignee: str(t.assignee), assigneeName: String(t.assigneeName ?? ''),
        due: str(t.due), done: t.done === true, discussionId: String(t.discussionId ?? ''), createdBy: String(t.createdBy ?? ''),
      }))
      const spaceId = name.slice(0, -6)
      const numbered = await syncDiscussions(spaceId, items, tasks, editors[0] ?? null)
      if (numbered.length) this.doc.transact(() => { for (const { id, number } of numbered) this.doc.getMap<Y.Map<unknown>>('discussions').get(id)?.set('decisionNumber', number) }, 'index')
      // What Nib searches when someone asks the space: each discussion's words, and the ideas board.
      const said = [...this.doc.getMap<Y.Map<unknown>>('discussions').entries()].map(([id, d]) => ({ key: `d:${id}`, text: [String(d.get('title') ?? ''), String(d.get('answer') ?? ''),
        ...((d.get('posts') as Y.Array<Y.Map<unknown>> | undefined)?.toArray() ?? []).map((p) => String(p.get('text') ?? ''))].filter(Boolean).join('\n') }))
      const ideas = cardsOf(this.doc).map((c) => c.text).filter(Boolean).join('\n')
      await indexSpace(spaceId, ideas ? [...said, { key: 'ideas', text: ideas }] : said)
      await this.logIdeas(spaceId, editors[0] ?? null)
      // The state of the space, asked for by a visit or Refresh.
      if (await this.ctx.storage.get<boolean>('stateWanted')) {
        await this.ctx.storage.delete('stateWanted')
        await writeState(spaceId)
      }
      return
    }
    if (name.endsWith(':threads')) {
      const id = name.slice(0, -8)
      // One Y.Map per thread with a `resolved` flag.
      const open = [...this.doc.getMap<Y.Map<unknown>>('threads').values()].filter((t) => t.get('resolved') !== true).length
      await this.env.DB.prepare('UPDATE documents SET open_comments = ? WHERE id = ?').bind(open, id).run()
      for (const user of editors) await touchEvent(id, user, 'commented', 'commented')
      await this.logMentions(id)
      await indexComments(id, this.commentsText())
      return
    }
    // Nib's check, asked for by a submit or the Nib menu. It runs here so the request stays fast.
    if (await this.ctx.storage.get<boolean>('checkWanted')) {
      await this.ctx.storage.delete('checkWanted')
      await checkDocument(name, toText(richFrom(this.doc)))
    }
    if (!this.changed) return
    this.changed = false
    // The editor stores blocks as XML in this fragment. Strip the tags, keep the words.
    const preview = this.doc.getXmlFragment('document-store').toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
    await this.env.DB.prepare('UPDATE documents SET preview = ?, updated_at = ? WHERE id = ?').bind(preview, Date.now(), name).run()
    const blocks = richFrom(this.doc)
    await indexBody(name, toText(blocks))
    // Tasks and decisions go to their D1 index. New decisions get a number, written back into the block.
    const numbered = await syncWork(name, workOf(blocks), editors[0] ?? null)
    if (numbered.length) this.doc.transact(() => { for (const { id, number } of numbered) findBlock(this.doc, id)?.setAttribute('number', number as unknown as string) }, 'index')
    // A baseline after the first edit, then at most one automatic version per half hour of work.
    const last = this.ctx.storage.sql.exec<{ at: number | null }>('SELECT MAX(created_at) AS at FROM versions').one().at
    if (!last || Date.now() - last > AUTO_VERSION_EVERY) this.snapshot(null, null)
    for (const user of editors) await touchEvent(name, user, 'edited', 'edited the text')
  }

  // New ideas on a space's board become events. The room remembers the cards it has logged; the first
  // run only learns them, so an old board does not flood the timeline. A card counts once it has text.
  async logIdeas(spaceId: string, actor: string | null) {
    const seen = await this.ctx.storage.get<string[]>('seenCards')
    const cards = cardsOf(this.doc).filter((c) => c.text.trim())
    const fresh = seen ? cards.filter((c) => !seen.includes(c.id)) : []
    if (seen && !fresh.length) return
    await this.ctx.storage.put('seenCards', cards.map((c) => c.id))
    if (!actor || !fresh.length) return
    const text = fresh.length === 1 ? `added an idea: “${fresh[0].text.slice(0, 80)}”` : `added ${fresh.length} ideas`
    await logSpaceEvent(spaceId, actor, 'idea', text, `/space/${spaceId}?tab=ideas`)
  }

  // Comments written since the last scan that mention someone become "mentioned Bea" events.
  // A mention is inline content of type "mention" with the person's id and name in its props.
  async logMentions(documentId: string) {
    const since = (await this.ctx.storage.get<number>('mentionsScannedAt')) ?? 0
    const now = Date.now()
    for (const thread of this.doc.getMap<Y.Map<unknown>>('threads').values()) {
      for (const comment of (thread.get('comments') as Y.Array<Y.Map<unknown>> | undefined)?.toArray() ?? []) {
        if (((comment.get('createdAt') as number) ?? 0) <= since) continue
        const author = comment.get('userId') as string
        const mentioned = new Map<string, string>()
        const walk = (node: unknown) => {
          if (Array.isArray(node)) return node.forEach(walk)
          if (!node || typeof node !== 'object') return
          const n = node as { type?: string; props?: { user?: string; name?: string }; content?: unknown; children?: unknown }
          if (n.type === 'mention' && n.props?.user) mentioned.set(n.props.user, n.props.name ?? 'someone')
          walk(n.content); walk(n.children)
        }
        walk(comment.get('body'))
        for (const [id, name] of mentioned) if (id !== author && id !== AI) await logEvent(documentId, author, 'mention', `mentioned ${name} in a comment`)
        if (mentioned.has(AI) && author !== AI) await this.aiReply(documentId, thread).catch((e) => console.error('AI reply failed', e))
      }
    }
    await this.ctx.storage.put('mentionsScannedAt', now)
  }

  // "@Nib" in a comment: the model reads the thread and the document, and its answer becomes a reply
  // by the user "ai", in the shape BlockNote's thread store writes (so every open tab shows it).
  async aiReply(documentId: string, thread: Y.Map<unknown>) {
    const comments = (thread.get('comments') as Y.Array<Y.Map<unknown>>).toArray()
    const said = comments.map((c) => `${c.get('userId') === AI ? 'Nib' : 'Person'}: ${plainOf(c.get('body'))}`).join('\n')
    const doc = toText((await this.env.DOC.get(this.env.DOC.idFromName(documentId)).readRich('now')) ?? [])
    let answer: string
    try { answer = await ask('reply', said, doc) } catch { answer = 'I am out of free uses for today. Ask me again tomorrow.' }
    const now = Date.now()
    const reply = new Y.Map<unknown>()
    this.doc.transact(() => {
      reply.set('id', crypto.randomUUID()); reply.set('userId', AI); reply.set('createdAt', now); reply.set('updatedAt', now)
      reply.set('body', [{ id: crypto.randomUUID(), type: 'paragraph', props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' }, content: [{ type: 'text', text: answer || 'I have no answer.', styles: {} }], children: [] }])
      reply.set('reactionsByUser', new Y.Map()); reply.set('metadata', undefined)
      ;(thread.get('comments') as Y.Array<Y.Map<unknown>>).push([reply])
    }, 'ai')
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

  // Every comment's words, for search. Bodies are BlockNote blocks: collect the text leaves.
  commentsText() {
    const words: string[] = []
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk)
      if (!node || typeof node !== 'object') return
      const n = node as { text?: string; props?: { name?: string }; type?: string; content?: unknown; children?: unknown }
      if (typeof n.text === 'string') words.push(n.text)
      if (n.type === 'mention' && n.props?.name) words.push('@' + n.props.name)
      walk(n.content); walk(n.children)
    }
    for (const thread of this.doc.getMap<Y.Map<unknown>>('threads').values())
      for (const comment of (thread.get('comments') as Y.Array<Y.Map<unknown>> | undefined)?.toArray() ?? []) walk(comment.get('body'))
    return words.join(' ')
  }

  // A space room's discussion, for a decision's page: the question and every message, as plain data.
  readDiscussion(id: string) {
    const d = this.doc.getMap<Y.Map<unknown>>('discussions').get(id)
    if (!d) return null
    const posts = ((d.get('posts') as Y.Array<Y.Map<unknown>> | undefined)?.toArray() ?? []).map((p) => ({ userId: String(p.get('userId') ?? ''), text: String(p.get('text') ?? ''), createdAt: Number(p.get('createdAt') ?? 0) }))
    return { title: String(d.get('title') ?? ''), owner: String(d.get('owner') ?? ''), due: String(d.get('due') ?? ''), posts }
  }

  readRich(id: number | 'now'): RichBlock[] | null {
    const doc = id === 'now' ? this.doc : this.docFrom(id)
    return doc && richFrom(doc)
  }

  // A list page changes a task (tick it done) or a decision: set the block's attributes, or the card's
  // task, in one transaction. It travels the normal update path, so open editors change in place.
  setTask(id: string, patch: { done?: boolean }) {
    const el = findBlock(this.doc, id)
    const card = this.doc.getMap<Y.Map<unknown>>('cards').get(id)
    const spaceTasks = this.doc.getMap<object>('tasks') // a space room's tasks, made from discussion posts
    if (!el && !card?.get('task') && !spaceTasks.has(id)) return false
    this.doc.transact(() => {
      if (el) for (const [k, v] of Object.entries(patch)) el.setAttribute(k, v as unknown as string)
      else if (card?.get('task')) card.set('task', { ...(card.get('task') as object), ...patch })
      else spaceTasks.set(id, { ...spaceTasks.get(id), ...patch })
    }, 'list')
    return true
  }

  // New content for a new document: a plan template, the welcome document (its task goes to `who`),
  // or the columns of a board. A space's ideas board is seeded when first opened, so it does nothing
  // once columns exist.
  seed(kind: 'plan' | 'welcome' | 'play' | 'board' | 'ideas', who?: { id: string; name: string }) {
    if (kind === 'board' || kind === 'ideas') {
      const groups = this.doc.getArray('groups')
      if (groups.length === 0) groups.push((kind === 'ideas' ? ['New', 'Exploring', 'Picked'] : ['Ideas', 'Maybe', 'Next']).map((name) => ({ id: crypto.randomUUID(), name })))
      return
    }
    const container = (content: Y.XmlElement) => { const c = new Y.XmlElement('blockContainer'); c.setAttribute('id', crypto.randomUUID()); c.insert(0, [content]); return c }
    // Text is a string, or runs of [text, marks]. Marks are stored the way y-prosemirror stores them.
    const el = (type: string, attrs: Record<string, unknown>, text: string | [string, object?][] = '') => {
      const e = new Y.XmlElement(type)
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v as string)
      const runs = typeof text === 'string' ? (text ? [[text]] as [string][] : []) : text
      if (runs.length) {
        const t = new Y.XmlText()
        let at = 0
        for (const [s, marks] of runs) { t.insert(at, s, marks ?? {}); at += s.length }
        e.insert(0, [t])
      }
      return e
    }
    const task = (text: string, assignee = '', assigneeName = '', due = '') => el('task', { taskId: crypto.randomUUID(), assignee, assigneeName, due, done: false }, text)
    const group = new Y.XmlElement('blockGroup')
    if (kind === 'play') {
      // A guest's first document: a short tour of what works without an account.
      if (this.doc.getXmlFragment('document-store').length) return
      const code = (s: string): [string, object] => [s, { code: {} }]
      const b = (s: string): [string, object] => [s, { bold: {} }]
      const by = { id: 'ai~play' } // "ai" authors show as Nib
      this.doc.transact(() => {
        this.doc.getXmlFragment('document-store').insert(0, [group])
        group.insert(0, [
          el('paragraph', {}, 'This document is yours to try CoWrite. Nobody else can see it, and you do not need an account. Change anything, and make more from Your documents.'),
          el('heading', { level: 2 }, 'Write'),
          el('paragraph', {}, [['Type '], code('/'), [' on an empty line for headings, lists, quotes, code, tables, and tasks. Select words to make them bold or to add a link.']]),
          el('heading', { level: 2 }, 'Accept a suggestion'),
          el('paragraph', {}, 'A suggestion shows a change that someone wants. It waits until someone accepts or rejects it. Accept this one from the suggestion bar above the text. On a phone, tap the round button at the bottom right.'),
          el('paragraph', {}, [['CoWrite is where a team '], ['writes', { deletion: by }], ['writes, reviews, and decides', { insertion: by }], ['.']]),
          el('heading', { level: 2 }, 'Tick a task'),
          task('Try CoWrite'),
          el('heading', { level: 2 }, 'Take it with you'),
          el('paragraph', {}, [['Download this document as Word, Markdown, or plain text from '], b('Export'), [', print it to PDF, or show it as slides.']]),
          el('heading', { level: 2 }, 'Keep it'),
          el('paragraph', {}, `Your documents stay in this browser for ${GUEST_DAYS} days after your last edit. Sign up, and they move into your account. Then you can also write with other people and use Nib, the assistant.`),
        ].map(container))
      })
      return
    }
    if (kind === 'welcome') {
      const b = (s: string): [string, object] => [s, { bold: {} }]
      const code = (s: string): [string, object] => [s, { code: {} }]
      const by = { id: 'ai~welcome' } // "ai" authors show as Nib
      this.doc.transact(() => {
        this.doc.getXmlFragment('document-store').insert(0, [group])
        group.insert(0, [
          el('paragraph', {}, 'Everything here works, so try it as you read. It is in your space, so its members can see it too. Delete it when you are done.'),
          el('heading', { level: 2 }, 'Accept a suggestion'),
          el('paragraph', {}, 'A suggestion shows a change that someone wants. It waits until someone accepts or rejects it. Accept this one from the suggestion bar above the text. On a phone, tap the round button at the bottom right.'),
          el('paragraph', {}, [['CoWrite is where a team '], ['writes', { deletion: by }], ['writes, reviews, and decides', { insertion: by }], ['.']]),
          el('heading', { level: 2 }, 'Ask Nib'),
          el('paragraph', {}, [['Select the sentence below, click '], b('✦ Ask Nib'), [' in the toolbar, and choose '], b('Make shorter'), ['. Or type '], code('@nib'), [' on an empty line and tell it what to write.']]),
          el('paragraph', {}, 'We are writing this particular sentence in a way that is a great deal longer than it really needs to be.'),
          el('heading', { level: 2 }, 'Tick a task'),
          el('paragraph', {}, [['Type '], code('/task'), [' to add one. Tasks show on the Tasks page of the person they are for.']]),
          task('Finish the welcome document', who?.id, who?.name), // no date: a welcome task must not turn late
          el('heading', { level: 2 }, 'Comment and mention'),
          el('paragraph', {}, [['Select any words and click the comment button. Type '], code('@'), [' to mention someone. They hear about it in their bell.']]),
          el('heading', { level: 2 }, 'Record a decision'),
          el('paragraph', {}, [['Type '], code('/decision'), ['. A decision gets a number and a page of its own, so a team can say “we settled that in D-12” and see why.']]),
          el('decision', { decisionId: crypto.randomUUID(), status: 'proposed', number: 0 }, 'Use CoWrite for our next plan'),
          el('paragraph', {}, [['Type '], code('/'), [' on an empty line for every kind of block: headings, lists, tables, images, tasks, and decisions. When you are done, keep this page as a cheat sheet, or delete it.']]),
        ].map(container))
      })
      return
    }
    this.doc.transact(() => {
      this.doc.getXmlFragment('document-store').insert(0, [group])
      group.insert(0, [
        el('paragraph', {}, 'One page for what we are doing, why, who does what, and by when. Replace each line below.'),
        el('heading', { level: 2 }, 'Goal'),
        el('paragraph', {}, 'The outcome, in one sentence someone outside the team would understand.'),
        el('heading', { level: 2 }, 'Why now'),
        el('paragraph', {}, 'What happens if we wait. One or two sentences.'),
        el('heading', { level: 2 }, 'Done looks like'),
        el('bulletListItem', {}, 'A result we can check, with a number'),
        el('bulletListItem', {}, 'What people will see or be able to do'),
        el('heading', { level: 2 }, 'Tasks'),
        task('Write the first draft'), task('Get feedback from two people'), task('Ship it'),
        el('heading', { level: 2 }, 'Decisions'),
        el('decision', { decisionId: crypto.randomUUID(), status: 'proposed', number: 0 }, 'The first thing we need to decide'),
        el('heading', { level: 2 }, 'Timeline'),
        el('checkListItem', { checked: false }, 'Week 1: draft'),
        el('checkListItem', { checked: false }, 'Week 2: review'),
        el('checkListItem', { checked: false }, 'Week 3: ship'),
        el('heading', { level: 2 }, 'Risks'),
        el('bulletListItem', {}, 'What could stop us, and what we will do about it'),
      ].map(container))
    })
  }

  // The state of a space is written from its room's alarm, like Nib's check. The caller marked it pending.
  async requestState() {
    await this.ctx.storage.put('stateWanted', true)
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now())
  }

  // Nib's check runs from the alarm: now, or with the edit alarm already due. The caller marked it pending in D1.
  async requestCheck() {
    await this.ctx.storage.put('checkWanted', true)
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now())
  }

  // Publishing freezes the document as it is now: a version named "Published".
  publish(userId: string) {
    return this.snapshot('Published', userId)
  }

  readVersion(id: number | 'now'): Block[] | null {
    const doc = id === 'now' ? this.doc : this.docFrom(id)
    if (!doc) return null
    // A board has no XML: read its columns and cards as blocks, flattened the same way.
    return isBoard(doc) ? boardBlocks(doc).map((b) => ({ type: b.type, level: b.props.level ?? null, text: inlineText(b.content) })) : blocksOf(doc)
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
    const groups = this.doc.getArray('groups'), cards = this.doc.getMap<Y.Map<unknown>>('cards')
    this.doc.transact(() => {
      dst.delete(0, dst.length)
      dst.insert(0, src.toArray().map((node) => node.clone()) as (Y.XmlElement | Y.XmlText)[])
      // A board: its columns and cards come back too.
      groups.delete(0, groups.length)
      groups.insert(0, old.getArray('groups').toArray())
      for (const key of [...cards.keys()]) cards.delete(key)
      for (const [key, card] of old.getMap<Y.Map<unknown>>('cards').entries()) cards.set(key, card.clone())
    }, 'restore')
    return true
  }

  // The document was deleted: close everyone, forget the alarm, drop every table.
  // A guest document (guest.server.ts). Claimed on sign-up, it becomes a normal room, and an alarm
  // now writes its text, tasks, and decisions to the account's indexes.
  async markGuest() {
    this.guest = true
    await this.ctx.storage.put('guest', true)
    await this.ctx.storage.put('editedAt', Date.now())
    await this.ctx.storage.setAlarm(Date.now() + GUEST_TTL) // so an untouched document expires too
  }
  async claim() {
    this.guest = false
    this.changed = true
    await this.ctx.storage.delete(['guest', 'editedAt'])
    await this.ctx.storage.setAlarm(Date.now())
  }

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
