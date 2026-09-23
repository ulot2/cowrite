import { env } from 'cloudflare:workers'
import { deleteDocument } from './db.server'
import { deleteSpace } from './access.server'
import { isKind, kinds, type Kind } from './kinds'

export { isKind, kinds, type Kind }

export type Settings = { color: string | null; muted: Kind[]; nib: boolean }

// The event types a person does not want in the bell.
export const mutedTypes = (muted: Kind[]): string[] => muted.flatMap((k) => [...kinds[k].types])

export const getSettings = async (userId: string): Promise<Settings> => {
  const row = await env.DB.prepare('SELECT color, muted, nib FROM user_settings WHERE user_id = ?').bind(userId).first<{ color: string | null; muted: string; nib: number }>()
  const muted = (() => { try { return (JSON.parse(row?.muted ?? '[]') as string[]).filter(isKind) } catch { return [] } })()
  return { color: row?.color ?? null, muted, nib: row ? row.nib === 1 : true }
}

// One upsert per change; unspecified fields keep their value.
export const saveSettings = (userId: string, patch: Partial<Settings>) => {
  const sets = [
    patch.color !== undefined && ['color', patch.color],
    patch.muted !== undefined && ['muted', JSON.stringify(patch.muted)],
    patch.nib !== undefined && ['nib', patch.nib ? 1 : 0],
  ].filter(Boolean) as [string, unknown][]
  if (!sets.length) return
  return env.DB.prepare(`INSERT INTO user_settings (user_id, ${sets.map(([c]) => c).join(', ')}) VALUES (?, ${sets.map(() => '?').join(', ')})
    ON CONFLICT (user_id) DO UPDATE SET ${sets.map(([c]) => `${c} = excluded.${c}`).join(', ')}`).bind(userId, ...sets.map(([, v]) => v)).run()
}

// What deleting the account takes with it, for the warning.
export const ownedCounts = async (userId: string) =>
  (await env.DB.prepare('SELECT (SELECT COUNT(*) FROM documents WHERE owner_id = ?1) AS docs, (SELECT COUNT(*) FROM spaces WHERE owner_id = ?1) AS spaces')
    .bind(userId).first<{ docs: number; spaces: number }>()) ?? { docs: 0, spaces: 0 }

// Deletes a person and what is only theirs. Their documents and spaces go (documents with their
// objects; other people's documents in their spaces stay, moved out). What they did stays in other
// people's timelines as "Deleted user". Sessions go last, so the browser is signed out.
export const deleteAccount = async (userId: string) => {
  const owned = await env.DB.prepare('SELECT id FROM documents WHERE owner_id = ?').bind(userId).all<{ id: string }>()
  for (const { id } of owned.results) await deleteDocument(id)
  const spaces = await env.DB.prepare('SELECT id FROM spaces WHERE owner_id = ?').bind(userId).all<{ id: string }>()
  for (const { id } of spaces.results) await deleteSpace(id)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM memberships WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM space_memberships WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM share_links WHERE created_by = ?').bind(userId),
    env.DB.prepare('DELETE FROM inbox_seen WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM user_settings WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM session WHERE userId = ?').bind(userId),
    env.DB.prepare('DELETE FROM account WHERE userId = ?').bind(userId),
    env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(userId),
  ])
}
