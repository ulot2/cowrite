import { env } from 'cloudflare:workers'
import { atLeast, type Role } from './roles'
import type { Status } from './status'
import { indexTitle, unindex } from './search.server'
import { unindexWork } from './work.server'

export type { Status }
export type Kind = 'doc' | 'board'
export type DocumentRow = { id: string; title: string; kind: Kind; preview: string; open_comments: number; updated_at: number; space_id: string | null; space_name: string | null; status: Status; role: Role }

const columns = 'd.id, d.title, d.kind, d.preview, d.open_comments, d.updated_at, d.space_id, d.status, s.name AS space_name'

// Documents this user can open: shared with them directly, or through a space they belong to.
// `role` is their direct role, else their space role. `limit` caps the list. Search lives in search.server.ts.
export const listDocuments = async (userId: string, { limit = 500 } = {}) =>
  (await env.DB.prepare(
    `SELECT ${columns}, COALESCE(m.role, sm.role) AS role FROM documents d
     LEFT JOIN memberships m ON m.document_id = d.id AND m.user_id = ?1
     LEFT JOIN spaces s ON s.id = d.space_id
     LEFT JOIN space_memberships sm ON sm.space_id = d.space_id AND sm.user_id = ?1
     WHERE m.user_id IS NOT NULL OR sm.user_id IS NOT NULL
     ORDER BY d.updated_at DESC LIMIT ?2`,
  ).bind(userId, limit).all<DocumentRow>()).results

// Documents inside one space, with the caller's role on the space as the role.
export const listSpaceDocuments = async (spaceId: string, role: Role) =>
  (await env.DB.prepare(`SELECT ${columns}, ?2 AS role FROM documents d LEFT JOIN spaces s ON s.id = d.space_id WHERE d.space_id = ?1 ORDER BY d.updated_at DESC`)
    .bind(spaceId, role).all<DocumentRow>()).results

export const getDocument = async (id: string) =>
  env.DB.prepare('SELECT id, title, kind, updated_at, space_id, status, preview, published_slug, published_version, published_at, check_state, check_findings, check_at FROM documents WHERE id = ?').bind(id)
    .first<{ id: string; title: string; kind: Kind; updated_at: number; space_id: string | null; status: Status; preview: string; published_slug: string | null; published_version: number | null; published_at: number | null
      check_state: 'pending' | 'done' | 'failed' | null; check_findings: string; check_at: number | null }>()

// One batch = one transaction: the document and its owner row appear together or not at all.
export const createDocument = async (userId: string, title: string, spaceId: string | null = null, kind: Kind = 'doc') => {
  const id = crypto.randomUUID()
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO documents (id, title, kind, owner_id, space_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, title, kind, userId, spaceId, now, now),
    env.DB.prepare('INSERT INTO memberships (document_id, user_id, role) VALUES (?, ?, ?)').bind(id, userId, 'owner'),
  ])
  await indexTitle(id, title)
  return id
}

export const setStatus = (id: string, status: Status) =>
  env.DB.prepare('UPDATE documents SET status = ? WHERE id = ?').bind(status, id).run()

// Section sign-off, per person per heading, while the document is in review.
export type SignoffRow = { block_id: string; user_id: string; name: string; state: 'agree' | 'concern'; note: string; heading: string; text_hash: string; at: number }
export const listSignoffs = async (documentId: string) =>
  (await env.DB.prepare(`SELECT s.block_id, s.user_id, COALESCE(u.name, 'Someone') AS name, s.state, s.note, s.heading, s.text_hash, s.at FROM signoffs s LEFT JOIN "user" u ON u.id = s.user_id WHERE s.document_id = ? ORDER BY s.at`)
    .bind(documentId).all<SignoffRow>()).results
export const setSignoff = (documentId: string, userId: string, s: { block: string; state: 'agree' | 'concern'; note: string; heading: string; hash: string }) =>
  env.DB.prepare(`INSERT INTO signoffs (document_id, block_id, user_id, state, note, heading, text_hash, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT DO UPDATE SET state = ?4, note = ?5, heading = ?6, text_hash = ?7, at = ?8`).bind(documentId, s.block, userId, s.state, s.note, s.heading, s.hash, Date.now()).run()
export const clearSignoff = (documentId: string, userId: string, block: string) =>
  env.DB.prepare('DELETE FROM signoffs WHERE document_id = ? AND user_id = ? AND block_id = ?').bind(documentId, userId, block).run()
export const clearSignoffs = (documentId: string) => env.DB.prepare('DELETE FROM signoffs WHERE document_id = ?').bind(documentId).run()
export const openConcern = (documentId: string) =>
  env.DB.prepare("SELECT heading FROM signoffs WHERE document_id = ? AND state = 'concern' LIMIT 1").bind(documentId).first<{ heading: string }>()

// The four ways to start. Write: empty. Plan: a template of Goal, Tasks, Decisions, Timeline.
// Brainstorm: a board with three columns. (Review is a queue, not a new document.)
export type Mode = 'write' | 'plan' | 'brainstorm'
const starts: Record<Mode, { title: string; kind: Kind; seed?: 'plan' | 'board' }> = {
  write: { title: 'Untitled', kind: 'doc' },
  plan: { title: 'Untitled plan', kind: 'doc', seed: 'plan' },
  brainstorm: { title: 'Untitled board', kind: 'board', seed: 'board' },
}
export const createInMode = async (userId: string, mode: Mode, spaceId: string | null = null, title?: string, status?: Status) => {
  const start = starts[mode] ?? starts.write
  const id = await createDocument(userId, title || start.title, spaceId, start.kind)
  if (status) await setStatus(id, status)
  if (start.seed) await env.DOC.get(env.DOC.idFromName(id)).seed(start.seed)
  return { id, title: title || start.title }
}

export const renameDocument = async (id: string, title: string) => {
  await env.DB.prepare('UPDATE documents SET title = ?, updated_at = ? WHERE id = ?').bind(title, Date.now(), id).run()
  await indexTitle(id, title)
}

// Memberships go with it (ON DELETE CASCADE). Then both objects (text and comments) drop their storage.
export const deleteDocument = async (id: string) => {
  await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(id).run()
  await unindex(id)
  await unindexWork(id)
  for (const room of [id, `${id}:threads`]) await env.DOC.get(env.DOC.idFromName(room)).wipe()
}

// Publishing. The slug outlives an unpublish, so a republished page keeps its address.
export const setPublished = (id: string, slug: string, version: number) =>
  env.DB.prepare('UPDATE documents SET published_slug = ?, published_version = ?, published_at = ? WHERE id = ?').bind(slug, version, Date.now(), id).run()
export const clearPublished = (id: string) =>
  env.DB.prepare('UPDATE documents SET published_version = NULL, published_at = NULL WHERE id = ?').bind(id).run()
export const getPublished = (slug: string) =>
  env.DB.prepare('SELECT id, title, preview, published_version, published_at FROM documents WHERE published_slug = ? AND published_version IS NOT NULL').bind(slug)
    .first<{ id: string; title: string; preview: string; published_version: number; published_at: number }>()

export type UserRow = { id: string; name: string; image: string | null; color: string | null }
// Names and avatars for a list of ids (at most 50: the comments UI and the version list ask in batches).
export const usersById = async (ids: string[]): Promise<UserRow[]> => {
  const some = [...new Set(ids)].slice(0, 50)
  if (some.length === 0) return []
  return (await env.DB.prepare(`SELECT u.id, u.name, u.image, us.color FROM "user" u LEFT JOIN user_settings us ON us.user_id = u.id WHERE u.id IN (${some.map(() => '?').join(',')})`).bind(...some).all<UserRow>()).results
}

// Documents waiting for a review this user can give: in review, they are a reviewer or above, and
// they did not submit it themselves. Oldest request first. `docs` saves the query when the caller has them.
export const reviewQueue = async (userId: string, docs?: DocumentRow[]) => {
  const waiting = (docs ?? await listDocuments(userId)).filter((d) => d.status === 'review' && atLeast(d.role, 'reviewer'))
  if (!waiting.length) return []
  const { results } = await env.DB.prepare(
    `SELECT e.document_id, e.actor_id, u.name, MAX(e.at) AS at FROM events e JOIN "user" u ON u.id = e.actor_id
     WHERE e.text = 'submitted for review' AND e.document_id IN (SELECT value FROM json_each(?)) GROUP BY e.document_id`,
  ).bind(JSON.stringify(waiting.map((d) => d.id))).all<{ document_id: string; actor_id: string; name: string; at: number }>()
  const by = new Map(results.map((r) => [r.document_id, r]))
  return waiting.filter((d) => by.get(d.id)?.actor_id !== userId)
    .map((d) => ({ id: d.id, title: d.title, preview: d.preview, space: d.space_name, by: by.get(d.id)?.name ?? null, at: by.get(d.id)?.at ?? d.updated_at }))
    .sort((a, b) => a.at - b.at)
}
