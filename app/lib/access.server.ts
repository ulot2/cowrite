import { env } from 'cloudflare:workers'
import { unindexSpace } from './discussions.server'
import { rank, type Role } from './roles'
import { requireUser } from './auth.server'
import { getDocument } from './db.server'

export type { Role }
const higher = (a: Role | null | undefined, b: Role | null | undefined) => (rank(a) >= rank(b) ? a ?? null : b ?? null)

export type SpaceRow = {
  id: string; name: string; owner_id: string; visibility: 'private' | 'public'; created_at: number; welcome_doc: string | null; start_done: string
  logo: string | null; color: string | null; description: string; nib: number; add_docs: 'editor' | 'commenter'
}
export type Member = { user_id: string; name: string; email: string; role: Role; color: string | null; image: string | null }
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

// A "Get started" step done by an action no table records. `by` finds the space: its id, or its welcome document.
export type StartStep = 'opened' | 'asked' | 'hidden'
export const markStart = (by: 'id' | 'welcome_doc', value: string, step: StartStep) =>
  env.DB.prepare(`UPDATE spaces SET start_done = start_done || ?2 || ',' WHERE ${by} = ?1 AND instr(start_done, ?2) = 0`).bind(value, step).run()

// Deleting a space keeps its documents: they leave the space and stay with their own members.
// People who could open them only through the space lose access. Space members and links go.
// Deletes a space. Its documents stay (moved out); its room (discussions) and their index go.
export const deleteSpace = async (id: string) => {
  await env.DOC.get(env.DOC.idFromName(`${id}:space`)).wipe()
  await unindexSpace(id)
  await deleteSpaceRows(id)
}
const deleteSpaceRows = (id: string) => env.DB.batch([
  env.DB.prepare('UPDATE documents SET space_id = NULL WHERE space_id = ?').bind(id),
  env.DB.prepare('UPDATE decisions SET space_id = NULL WHERE space_id = ?').bind(id),
  env.DB.prepare("DELETE FROM share_links WHERE target_type = 'space' AND target_id = ?").bind(id),
  env.DB.prepare('DELETE FROM space_memberships WHERE space_id = ?').bind(id),
  env.DB.prepare('DELETE FROM spaces WHERE id = ?').bind(id),
])

// The owner's settings. The keys come from the settings page's code, never from the request.
type SpaceSettings = Partial<Pick<SpaceRow, 'name' | 'logo' | 'color' | 'description' | 'visibility' | 'nib' | 'add_docs'>>
export const updateSpace = (id: string, set: SpaceSettings) =>
  env.DB.prepare(`UPDATE spaces SET ${Object.keys(set).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(set), id).run()

// Whether this role may add documents to the space: editors always, commenters when the owner allows it.
export const canAddDocs = (role: Role | null, space: Pick<SpaceRow, 'add_docs'>) => rank(role) >= rank(space.add_docs === 'commenter' ? 'commenter' : 'editor')

// Nib's space features (the summary, Ask, next steps, the check before review). A document outside a space has them.
export const nibInSpace = async (spaceId: string | null) =>
  !spaceId || (await env.DB.prepare('SELECT nib FROM spaces WHERE id = ?').bind(spaceId).first<{ nib: number }>())?.nib !== 0

// A new owner: they get the owner role, and the old owner stays on as an editor.
export const transferSpace = (id: string, from: string, to: string) => env.DB.batch([
  env.DB.prepare('UPDATE spaces SET owner_id = ? WHERE id = ?').bind(to, id),
  env.DB.prepare("UPDATE space_memberships SET role = 'editor' WHERE space_id = ? AND user_id = ?").bind(id, from),
  env.DB.prepare("UPDATE space_memberships SET role = 'owner' WHERE space_id = ? AND user_id = ?").bind(id, to),
])

export const moveDocument = (documentId: string, spaceId: string | null) =>
  env.DB.prepare('UPDATE documents SET space_id = ? WHERE id = ?').bind(spaceId, documentId).run()

// Members of a document or a space, with names for the dialog.
export const listMembers = async (target: 'document' | 'space', id: string) => {
  const table = target === 'document' ? 'memberships' : 'space_memberships'
  const column = target === 'document' ? 'document_id' : 'space_id'
  return (await env.DB.prepare(`SELECT m.user_id, u.name, u.email, m.role, us.color, u.image FROM ${table} m JOIN "user" u ON u.id = m.user_id LEFT JOIN user_settings us ON us.user_id = u.id WHERE m.${column} = ? ORDER BY u.name`).bind(id).all<Member>()).results
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

// Signed in and allowed to open this document, else the login page or a 404.
export const requireDocument = async (request: Request, documentId: string) => {
  const user = await requireUser(request)
  const role = await roleOnDocument(user.id, documentId)
  const document = role && await getDocument(documentId)
  if (!role || !document) throw new Response('Not found', { status: 404 })
  return { user, role, document }
}
