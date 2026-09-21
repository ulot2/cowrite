import { env } from 'cloudflare:workers'
import { rank, type Role } from './roles'

export type { Role }
const higher = (a: Role | null | undefined, b: Role | null | undefined) => (rank(a) >= rank(b) ? a ?? null : b ?? null)

export type SpaceRow = { id: string; name: string; owner_id: string; visibility: 'private' | 'public'; created_at: number }
export type Member = { user_id: string; name: string; email: string; role: Role }
export type ShareLink = { token: string; target_type: 'document' | 'space'; target_id: string; role: Role; created_at: number }

// A person's role on a space: their membership, or viewer when the space is public.
export const roleOnSpace = async (userId: string, spaceId: string): Promise<Role | null> => {
  const row = await env.DB.prepare(
    `SELECT s.visibility, m.role FROM spaces s LEFT JOIN space_memberships m ON m.space_id = s.id AND m.user_id = ? WHERE s.id = ?`,
  ).bind(userId, spaceId).first<{ visibility: string; role: Role | null }>()
  if (!row) return null
  return row.role ?? (row.visibility === 'public' ? 'viewer' : null)
}

// A person's role on a document: the highest of their direct membership and their role on its space.
export const roleOnDocument = async (userId: string, documentId: string): Promise<Role | null> => {
  const row = await env.DB.prepare(
    `SELECT d.space_id, m.role FROM documents d LEFT JOIN memberships m ON m.document_id = d.id AND m.user_id = ? WHERE d.id = ?`,
  ).bind(userId, documentId).first<{ space_id: string | null; role: Role | null }>()
  if (!row) return null
  const viaSpace = row.space_id ? await roleOnSpace(userId, row.space_id) : null
  return higher(row.role, viaSpace)
}

export const getSpace = (id: string) => env.DB.prepare('SELECT * FROM spaces WHERE id = ?').bind(id).first<SpaceRow>()

export const listSpaces = async (userId: string) =>
  (await env.DB.prepare('SELECT s.* FROM spaces s JOIN space_memberships m ON m.space_id = s.id WHERE m.user_id = ? ORDER BY s.name').bind(userId).all<SpaceRow>()).results

export const createSpace = async (userId: string, name: string) => {
  const id = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO spaces (id, name, owner_id, visibility, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, name, userId, 'private', Date.now()),
    env.DB.prepare('INSERT INTO space_memberships (space_id, user_id, role) VALUES (?, ?, ?)').bind(id, userId, 'owner'),
  ])
  return id
}

export const setSpaceVisibility = (id: string, visibility: 'private' | 'public') =>
  env.DB.prepare('UPDATE spaces SET visibility = ? WHERE id = ?').bind(visibility, id).run()

export const moveDocument = (documentId: string, spaceId: string | null) =>
  env.DB.prepare('UPDATE documents SET space_id = ? WHERE id = ?').bind(spaceId, documentId).run()

// Members of a document or a space, with names for the dialog.
export const listMembers = async (target: 'document' | 'space', id: string) => {
  const table = target === 'document' ? 'memberships' : 'space_memberships'
  const column = target === 'document' ? 'document_id' : 'space_id'
  return (await env.DB.prepare(`SELECT m.user_id, u.name, u.email, m.role FROM ${table} m JOIN "user" u ON u.id = m.user_id WHERE m.${column} = ? ORDER BY u.name`).bind(id).all<Member>()).results
}

// Adds or changes one membership. The caller has checked that the actor is the owner.
export const setMember = (target: 'document' | 'space', id: string, userId: string, role: Role) => {
  const table = target === 'document' ? 'memberships' : 'space_memberships'
  const column = target === 'document' ? 'document_id' : 'space_id'
  return env.DB.prepare(`INSERT INTO ${table} (${column}, user_id, role) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET role = excluded.role`).bind(id, userId, role).run()
}

export const removeMember = (target: 'document' | 'space', id: string, userId: string) => {
  const table = target === 'document' ? 'memberships' : 'space_memberships'
  const column = target === 'document' ? 'document_id' : 'space_id'
  return env.DB.prepare(`DELETE FROM ${table} WHERE ${column} = ? AND user_id = ? AND role != 'owner'`).bind(id, userId).run()
}

export const findUserByEmail = (email: string) =>
  env.DB.prepare('SELECT id, name FROM "user" WHERE email = ?').bind(email.trim().toLowerCase()).first<{ id: string; name: string }>()

// Share links. One per target: creating a new one replaces the old, which revokes it.
export const getShareLink = (target: 'document' | 'space', id: string) =>
  env.DB.prepare('SELECT * FROM share_links WHERE target_type = ? AND target_id = ?').bind(target, id).first<ShareLink>()

export const createShareLink = async (target: 'document' | 'space', id: string, role: Role, userId: string) => {
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  await env.DB.batch([
    env.DB.prepare('DELETE FROM share_links WHERE target_type = ? AND target_id = ?').bind(target, id),
    env.DB.prepare('INSERT INTO share_links (token, target_type, target_id, role, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(token, target, id, role, userId, Date.now()),
  ])
  return token
}

export const revokeShareLink = (target: 'document' | 'space', id: string) =>
  env.DB.prepare('DELETE FROM share_links WHERE target_type = ? AND target_id = ?').bind(target, id).run()

export const findShareLink = (token: string) => env.DB.prepare('SELECT * FROM share_links WHERE token = ?').bind(token).first<ShareLink>()

// Following a link grants its role, unless the person already has a higher one. True when it granted.
export const redeemShareLink = async (link: ShareLink, userId: string) => {
  const current = link.target_type === 'document' ? await roleOnDocument(userId, link.target_id) : await roleOnSpace(userId, link.target_id)
  if (rank(current) >= rank(link.role)) return false
  await setMember(link.target_type, link.target_id, userId, link.role)
  return true
}

export const findUser = (id: string) => env.DB.prepare('SELECT id, name FROM "user" WHERE id = ?').bind(id).first<{ id: string; name: string }>()
