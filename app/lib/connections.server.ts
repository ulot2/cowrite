import { env } from 'cloudflare:workers'
import { roleOnDocument, roleOnSpace } from './access.server'
import { atLeast, type Role } from './roles'
import { docStub } from './versions.server'
import { ideaRef, workKey, type ConnectedItem, type Connections, type WorkNode, type WorkRef } from './connections'

type Scope = { space: string | null; owner: string }
type Context = Scope & { ref: WorkRef; role: Role; canManage: boolean }
type DocRow = { id: string; title: string; space_id: string | null; owner_id: string; kind: string; status: string }
type LinkRow = { id: string; source: string; target: string; relation: 'related' | 'implements' }
type Edge = { source: string; target: string; relation: 'origin' | 'contains' | 'related' | 'implements' | 'supersedes'; id?: string }
const missing = () => new Response('Not found', { status: 404 })
const ideaParts = (id: string) => /^(space|doc)\/([^:]+):(.+)$/.exec(id)
const docWhere = `(EXISTS (SELECT 1 FROM memberships m WHERE m.document_id = d.id AND m.user_id = ?1)
  OR EXISTS (SELECT 1 FROM space_memberships sm WHERE sm.space_id = d.space_id AND sm.user_id = ?1)
  OR EXISTS (SELECT 1 FROM spaces s WHERE s.id = d.space_id AND s.visibility = 'public'))`

// Resolve access from the item itself, never from a caller-provided space or title.
async function context(user: string, ref: WorkRef): Promise<Context> {
  let document: string | null = null, space: string | null = null, owner = ''
  if (ref.kind === 'document') document = ref.id
  if (ref.kind === 'idea') {
    const p = ideaParts(ref.id)
    if (!p) throw missing()
    if (p[1] === 'space') space = p[2]
    else document = p[2]
  }
  if (ref.kind === 'discussion') {
    const row = await env.DB.prepare('SELECT space_id FROM discussions WHERE id = ?').bind(ref.id).first<{ space_id: string }>()
    if (!row) throw missing()
    space = row.space_id
  }
  if (ref.kind === 'decision') {
    const row = await env.DB.prepare('SELECT document_id, space_id FROM decisions WHERE id = ?').bind(ref.id).first<{ document_id: string; space_id: string | null }>()
    if (!row) throw missing()
    // Same visibility as the decision page: a space decision needs space access.
    if (row.space_id) space = row.space_id
    else document = row.document_id
  }
  if (ref.kind === 'task') {
    const row = await env.DB.prepare('SELECT document_id, space_id, discussion_id FROM tasks WHERE id = ?').bind(ref.id).first<{ document_id: string; space_id: string | null; discussion_id: string | null }>()
    if (!row) throw missing()
    if (row.discussion_id) space = row.space_id
    else document = row.document_id
  }
  if (document) {
    const [role, doc] = await Promise.all([
      roleOnDocument(user, document),
      env.DB.prepare('SELECT space_id, owner_id FROM documents WHERE id = ?').bind(document).first<{ space_id: string | null; owner_id: string }>(),
    ])
    if (!role || !doc) throw missing()
    return { ref, role, space: doc.space_id, owner: doc.owner_id, canManage: atLeast(role, ref.kind === 'idea' ? 'reviewer' : 'editor') }
  }
  if (space) {
    const [role, row] = await Promise.all([
      roleOnSpace(user, space),
      env.DB.prepare('SELECT owner_id FROM spaces WHERE id = ?').bind(space).first<{ owner_id: string }>(),
    ])
    if (!role || !row) throw missing()
    owner = row.owner_id
    return { ref, role, space, owner, canManage: atLeast(role, ref.kind === 'decision' ? 'editor' : 'commenter') }
  }
  throw missing()
}

async function inventory(user: string, scope: Scope) {
  const nodes = new Map<string, WorkNode>(), edges: Edge[] = []
  const add = (node: WorkNode) => nodes.set(workKey(node), node)
  const edge = (a: WorkRef, b: WorkRef, relation: Edge['relation']) => edges.push({ source: workKey(a), target: workKey(b), relation })
  const where = scope.space ? 'd.space_id = ?2' : 'd.space_id IS NULL AND d.owner_id = ?2'
  const docs = (await env.DB.prepare(`SELECT d.id, d.title, d.space_id, d.owner_id, d.kind, d.status FROM documents d WHERE ${where} AND ${docWhere} ORDER BY d.updated_at DESC`)
    .bind(user, scope.space ?? scope.owner).all<DocRow>()).results
  for (const d of docs) add({ kind: 'document', id: d.id, label: d.title || 'Untitled document', href: `/doc/${encodeURIComponent(d.id)}`, status: d.status })
  const ids = JSON.stringify(docs.map((d) => d.id))
  const spaceRole = scope.space ? await roleOnSpace(user, scope.space) : null
  const [tasks, decisions] = await Promise.all([
    env.DB.prepare(`SELECT id, document_id, discussion_id, space_id, text, done FROM tasks
      WHERE document_id IN (SELECT value FROM json_each(?1)) OR (?2 IS NOT NULL AND space_id = ?2 AND discussion_id IS NOT NULL)`)
      .bind(ids, spaceRole ? scope.space : null).all<{ id: string; document_id: string; discussion_id: string | null; space_id: string | null; text: string; done: number }>(),
    env.DB.prepare(`SELECT id, document_id, source_id, source_type, text, number, status, supersedes,
      EXISTS (SELECT 1 FROM decisions r WHERE r.supersedes = decisions.id) AS replaced FROM decisions
      WHERE (?2 IS NOT NULL AND space_id = ?2) OR (space_id IS NULL AND document_id IN (SELECT value FROM json_each(?1)))`)
      .bind(ids, spaceRole ? scope.space : null).all<{ id: string; document_id: string; source_id: string | null; source_type: string; text: string; number: number; status: string; supersedes: string | null; replaced: number }>(),
  ])
  for (const t of tasks.results) {
    const parent: WorkRef = t.discussion_id ? { kind: 'discussion', id: t.discussion_id } : { kind: 'document', id: t.document_id }
    add({ kind: 'task', id: t.id, label: t.text || 'Untitled task', href: `/tasks?task=${encodeURIComponent(t.id)}#task-${encodeURIComponent(t.id)}`, status: t.done ? 'done' : 'open' })
    edge(parent, { kind: 'task', id: t.id }, 'contains')
  }
  for (const d of decisions.results) {
    add({ kind: 'decision', id: d.id, label: `D-${d.number} · ${d.text || 'Untitled decision'}`, href: `/decision/${encodeURIComponent(d.id)}`, status: d.replaced ? 'replaced' : d.status })
    edge({ kind: d.source_type === 'discussion' ? 'discussion' : 'document', id: d.source_id || d.document_id }, { kind: 'decision', id: d.id }, 'origin')
    if (d.supersedes) edge({ kind: 'decision', id: d.supersedes }, { kind: 'decision', id: d.id }, 'supersedes')
  }
  // Read provenance from the existing CRDT, including old boards. No migration,
  // duplicate source index, or manual re-linking is needed for those relationships.
  const rooms = docs.filter((d) => d.kind === 'board').map((d) => ({ id: `doc/${d.id}`, stub: d.id }))
  if (scope.space && spaceRole) rooms.push({ id: `space/${scope.space}`, stub: `${scope.space}:space` })
  const snapshots = await Promise.all(rooms.map(async (room) => ({ room, data: await docStub(room.stub).readConnections() })))
  for (const { room, data } of snapshots) {
    const isSpace = room.id.startsWith('space/')
    for (const card of data.cards) {
      const ref = ideaRef(room.id, card.id)
      const query = `idea=${encodeURIComponent(card.id)}`
      add({ ...ref, label: card.text.trim().split('\n')[0].slice(0, 180) || 'Untitled idea', href: isSpace ? `/space/${scope.space}?tab=ideas&${query}` : `/doc/${room.stub}?${query}`, status: card.task?.done ? 'done' : 'idea' })
      if (!isSpace) edge({ kind: 'document', id: room.stub }, ref, 'contains')
      if (card.doc) edge(ref, { kind: 'document', id: card.doc }, 'origin')
      if (card.discussion) edge(ref, { kind: 'discussion', id: card.discussion }, 'origin')
      if (card.task) edge(ref, { kind: 'task', id: card.id }, 'origin')
    }
    if (isSpace) for (const d of data.discussions) {
      add({ kind: 'discussion', id: d.id, label: d.title || 'Untitled discussion', href: `/space/${scope.space}?tab=discussions&d=${encodeURIComponent(d.id)}`, status: d.status })
      if (d.idea) edge(ideaRef(room.id, d.idea), { kind: 'discussion', id: d.id }, 'origin')
    }
  }
  return { nodes, edges }
}

const relationship = (e: Edge, from: string) => e.relation === 'related' ? 'Related work'
  : e.relation === 'implements' ? e.source === from ? 'Implemented by' : 'Implements'
  : e.relation === 'supersedes' ? e.source === from ? 'Replaced by' : 'Replaces'
  : e.relation === 'contains' ? e.source === from ? 'Contains' : 'Part of'
  : e.source === from ? 'Led to' : 'Started from'

export async function connectedWork(user: string, ref: WorkRef): Promise<Connections> {
  const ctx = await context(user, ref)
  const { nodes, edges } = await inventory(user, ctx)
  const key = workKey(ref), anchor = nodes.get(key)
  if (!anchor) throw missing()
  const keys = JSON.stringify([...nodes.keys()])
  const explicit = (await env.DB.prepare(`SELECT id, source, target, relation FROM work_links
    WHERE source IN (SELECT value FROM json_each(?1)) AND target IN (SELECT value FROM json_each(?1))`)
    .bind(keys).all<LinkRow>()).results
  edges.push(...explicit)
  // Never traverse a hidden or deleted item, including as a bridge to other work.
  const visible = edges.filter((e) => nodes.has(e.source) && nodes.has(e.target))
    .sort((a, b) => Number(!!b.id) - Number(!!a.id) || Number(b.relation === 'implements') - Number(a.relation === 'implements'))
  const adjacent = new Map<string, Edge[]>()
  for (const e of visible) for (const endpoint of [e.source, e.target]) {
    const list = adjacent.get(endpoint) ?? []; list.push(e); adjacent.set(endpoint, list)
  }
  const seen = new Set([key]), queue = [{ key, depth: 0 }], items: ConnectedItem[] = []
  const directReasons = new Map<string, Set<string>>()
  for (const e of adjacent.get(key) ?? []) {
    const other = e.source === key ? e.target : e.source
    const reasons = directReasons.get(other) ?? new Set<string>()
    reasons.add(relationship(e, key)); directReasons.set(other, reasons)
  }
  for (let i = 0; i < queue.length && items.length < 60; i++) {
    const current = queue[i]
    if (current.depth >= 3) continue
    for (const e of adjacent.get(current.key) ?? []) {
      const other = e.source === current.key ? e.target : e.source
      if (seen.has(other)) continue
      seen.add(other)
      const depth = current.depth + 1
      items.push({ ...nodes.get(other)!, depth, reason: depth === 1 ? [...directReasons.get(other)!].join(' · ') : `Via ${nodes.get(current.key)!.label}`, linkId: depth === 1 ? e.id : undefined })
      queue.push({ key: other, depth })
      if (items.length === 60) break
    }
  }
  const directlyLinked = new Set((adjacent.get(key) ?? []).filter((e) => e.id).map((e) => e.source === key ? e.target : e.source))
  return { anchor, canManage: ctx.canManage, items, candidates: ctx.canManage ? [...nodes.values()].filter((n) => workKey(n) !== key && !directlyLinked.has(workKey(n))) : [], truncated: items.length === 60 }
}

export async function changeConnection(user: string, ref: WorkRef, fields: FormData) {
  const ctx = await context(user, ref)
  if (!ctx.canManage) throw new Response('You cannot change connections for this item.', { status: 403 })
  const graph = await connectedWork(user, ref)
  if (fields.get('intent') === 'unlink') {
    const id = String(fields.get('link') ?? '')
    // A direct explicit relationship can be removed from either end.
    const existing = await env.DB.prepare('SELECT source, target FROM work_links WHERE id = ?').bind(id).first<{ source: string; target: string }>()
    const key = workKey(ref)
    if (!existing || (existing.source !== key && existing.target !== key)) throw missing()
    await env.DB.prepare('DELETE FROM work_links WHERE id = ?').bind(id).run()
    return { ...(await connectedWork(user, ref)), message: 'Connection removed.' }
  }
  if (fields.get('intent') !== 'link') return { ...graph, error: 'Choose a connection to add.' }
  const target = [...graph.candidates, ...graph.items].find((n) => workKey(n) === fields.get('target'))
  if (!target) return { ...graph, error: 'Choose an item from the available work.' }
  let source = workKey(ref), destination = workKey(target)
  const relation = fields.get('relation') === 'implements' ? 'implements' : 'related'
  if (relation === 'implements') {
    if (ref.kind === 'decision' && (target.kind === 'document' || target.kind === 'task')) { /* decision -> implementation */ }
    else if (target.kind === 'decision' && (ref.kind === 'document' || ref.kind === 'task')) [source, destination] = [destination, source]
    else return { ...graph, error: 'Only a document or task can implement a decision.' }
  } else if (source > destination) [source, destination] = [destination, source]
  await env.DB.prepare('INSERT OR IGNORE INTO work_links (id, source, target, relation, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), source, destination, relation, user, Date.now()).run()
  return { ...(await connectedWork(user, ref)), message: 'Work connected.' }
}
