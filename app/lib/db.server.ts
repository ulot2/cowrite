import { env } from 'cloudflare:workers'

export type Role = 'owner' | 'editor' | 'viewer'
export type DocumentRow = { id: string; title: string; preview: string; updated_at: number; role: Role }

// Documents this user can open, newest change first. `q` narrows by title or text, `limit` caps the list.
export const listDocuments = async (userId: string, { q = '', limit = 500 } = {}) =>
  (await env.DB.prepare(
    `SELECT d.id, d.title, d.preview, d.updated_at, m.role FROM documents d JOIN memberships m ON m.document_id = d.id
     WHERE m.user_id = ?1 AND (d.title LIKE ?2 OR d.preview LIKE ?2) ORDER BY d.updated_at DESC LIMIT ?3`,
  ).bind(userId, `%${q}%`, limit).all<DocumentRow>()).results

// The role of a user on a document, or undefined when they have none.
export const roleOf = async (documentId: string, userId: string) =>
  (await env.DB.prepare('SELECT role FROM memberships WHERE document_id = ? AND user_id = ?')
    .bind(documentId, userId).first<{ role: Role }>())?.role

export const getDocument = async (id: string) =>
  env.DB.prepare('SELECT id, title, updated_at FROM documents WHERE id = ?').bind(id).first<{ id: string; title: string; updated_at: number }>()

// One batch = one transaction: the document and its owner row appear together or not at all.
export const createDocument = async (userId: string, title: string) => {
  const id = crypto.randomUUID()
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO documents (id, title, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(id, title, userId, now, now),
    env.DB.prepare('INSERT INTO memberships (document_id, user_id, role) VALUES (?, ?, ?)').bind(id, userId, 'owner'),
  ])
  return id
}

export const renameDocument = (id: string, title: string) =>
  env.DB.prepare('UPDATE documents SET title = ?, updated_at = ? WHERE id = ?').bind(title, Date.now(), id).run()

// Memberships go with it (ON DELETE CASCADE). The Doc object's storage stays until slice 5 adds cleanup.
export const deleteDocument = (id: string) =>
  env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(id).run()
