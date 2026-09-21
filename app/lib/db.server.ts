import { env } from 'cloudflare:workers'
import type { Role } from './roles'

export type DocumentRow = { id: string; title: string; preview: string; open_comments: number; updated_at: number; space_id: string | null; space_name: string | null; role: Role }

const columns = 'd.id, d.title, d.preview, d.open_comments, d.updated_at, d.space_id, s.name AS space_name'

// Documents this user can open: shared with them directly, or through a space they belong to.
// `role` is their direct role, else their space role. `q` narrows by title or text, `limit` caps the list.
export const listDocuments = async (userId: string, { q = '', limit = 500 } = {}) =>
  (await env.DB.prepare(
    `SELECT ${columns}, COALESCE(m.role, sm.role) AS role FROM documents d
     LEFT JOIN memberships m ON m.document_id = d.id AND m.user_id = ?1
     LEFT JOIN spaces s ON s.id = d.space_id
     LEFT JOIN space_memberships sm ON sm.space_id = d.space_id AND sm.user_id = ?1
     WHERE (m.user_id IS NOT NULL OR sm.user_id IS NOT NULL) AND (d.title LIKE ?2 OR d.preview LIKE ?2)
     ORDER BY d.updated_at DESC LIMIT ?3`,
  ).bind(userId, `%${q}%`, limit).all<DocumentRow>()).results

// Documents inside one space, with the caller's role on the space as the role.
export const listSpaceDocuments = async (spaceId: string, role: Role) =>
  (await env.DB.prepare(`SELECT ${columns}, ?2 AS role FROM documents d LEFT JOIN spaces s ON s.id = d.space_id WHERE d.space_id = ?1 ORDER BY d.updated_at DESC`)
    .bind(spaceId, role).all<DocumentRow>()).results

export const getDocument = async (id: string) =>
  env.DB.prepare('SELECT id, title, updated_at, space_id FROM documents WHERE id = ?').bind(id).first<{ id: string; title: string; updated_at: number; space_id: string | null }>()

// One batch = one transaction: the document and its owner row appear together or not at all.
export const createDocument = async (userId: string, title: string, spaceId: string | null = null) => {
  const id = crypto.randomUUID()
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO documents (id, title, owner_id, space_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, title, userId, spaceId, now, now),
    env.DB.prepare('INSERT INTO memberships (document_id, user_id, role) VALUES (?, ?, ?)').bind(id, userId, 'owner'),
  ])
  return id
}

export const renameDocument = (id: string, title: string) =>
  env.DB.prepare('UPDATE documents SET title = ?, updated_at = ? WHERE id = ?').bind(title, Date.now(), id).run()

// Memberships go with it (ON DELETE CASCADE). Then both objects (text and comments) drop their storage.
export const deleteDocument = async (id: string) => {
  await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(id).run()
  for (const room of [id, `${id}:threads`]) await env.DOC.get(env.DOC.idFromName(room)).wipe()
}

export type UserRow = { id: string; name: string; image: string | null }
// Names and avatars for a list of ids (at most 50: the comments UI and the version list ask in batches).
export const usersById = async (ids: string[]): Promise<UserRow[]> => {
  const some = [...new Set(ids)].slice(0, 50)
  if (some.length === 0) return []
  return (await env.DB.prepare(`SELECT id, name, image FROM "user" WHERE id IN (${some.map(() => '?').join(',')})`).bind(...some).all<UserRow>()).results
}
