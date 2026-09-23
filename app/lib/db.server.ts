import { env } from 'cloudflare:workers'
import type { Role } from './roles'
import { indexTitle, unindex } from './search.server'
import { unindexWork } from './work.server'

export type Status = 'draft' | 'review' | 'approved'
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
  env.DB.prepare('SELECT id, title, kind, updated_at, space_id, status, preview, published_slug, published_version, published_at FROM documents WHERE id = ?').bind(id)
    .first<{ id: string; title: string; kind: Kind; updated_at: number; space_id: string | null; status: Status; preview: string; published_slug: string | null; published_version: number | null; published_at: number | null }>()

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

// The four ways to start. Write: empty. Plan: a template of Goal, Tasks, Decisions, Timeline.
// Brainstorm: a board with three columns. (Review is a queue, not a new document.)
export type Mode = 'write' | 'plan' | 'brainstorm'
const starts: Record<Mode, { title: string; kind: Kind; seed?: 'plan' | 'board' }> = {
  write: { title: 'Untitled', kind: 'doc' },
  plan: { title: 'Untitled plan', kind: 'doc', seed: 'plan' },
  brainstorm: { title: 'Untitled board', kind: 'board', seed: 'board' },
}
export const createInMode = async (userId: string, mode: Mode, spaceId: string | null = null, title?: string) => {
  const start = starts[mode] ?? starts.write
  const id = await createDocument(userId, title || start.title, spaceId, start.kind)
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

export type UserRow = { id: string; name: string; image: string | null }
// Names and avatars for a list of ids (at most 50: the comments UI and the version list ask in batches).
export const usersById = async (ids: string[]): Promise<UserRow[]> => {
  const some = [...new Set(ids)].slice(0, 50)
  if (some.length === 0) return []
  return (await env.DB.prepare(`SELECT id, name, image FROM "user" WHERE id IN (${some.map(() => '?').join(',')})`).bind(...some).all<UserRow>()).results
}
