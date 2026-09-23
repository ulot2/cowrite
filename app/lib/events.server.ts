import { env } from 'cloudflare:workers'

export type EventRow = { id: number; document_id: string | null; actor_id: string; actor: string; actor_color: string | null; actor_image: string | null; type: string; text: string; at: number; title: string | null }

// How long the same person doing the same thing on the same document counts as one event.
const COLLAPSE = 30 * 60 * 1000

// Logs something that happened to a document. The space id is copied from the document row,
// so a document that is already deleted logs nothing.
export const logEvent = (documentId: string, actorId: string, type: string, text: string) =>
  env.DB.prepare('INSERT INTO events (space_id, document_id, actor_id, type, text, at) SELECT space_id, id, ?1, ?2, ?3, ?4 FROM documents WHERE id = ?5')
    .bind(actorId, type, text, Date.now(), documentId).run()

export const logSpaceEvent = (spaceId: string, actorId: string, type: string, text: string) =>
  env.DB.prepare('INSERT INTO events (space_id, actor_id, type, text, at) VALUES (?, ?, ?, ?, ?)').bind(spaceId, actorId, type, text, Date.now()).run()

// Edits and comments repeat. Within 30 minutes, the same actor and type moves the last event forward instead of adding one.
export const touchEvent = async (documentId: string, actorId: string, type: string, text: string) => {
  const now = Date.now()
  const { meta } = await env.DB.prepare(
    'UPDATE events SET at = ?1 WHERE id = (SELECT id FROM events WHERE document_id = ?2 AND actor_id = ?3 AND type = ?4 AND at > ?5 ORDER BY at DESC LIMIT 1)',
  ).bind(now, documentId, actorId, type, now - COLLAPSE).run()
  if (meta.changes === 0) await logEvent(documentId, actorId, type, text)
}

const columns = "e.id, e.document_id, e.actor_id, COALESCE(u.name, 'Deleted user') AS actor, us.color AS actor_color, u.image AS actor_image, e.type, e.text, e.at, d.title"
const joins = 'FROM events e LEFT JOIN "user" u ON u.id = e.actor_id LEFT JOIN user_settings us ON us.user_id = e.actor_id LEFT JOIN documents d ON d.id = e.document_id'

export const listSpaceEvents = async (spaceId: string) =>
  (await env.DB.prepare(`SELECT ${columns} ${joins} WHERE e.space_id = ? ORDER BY e.at DESC LIMIT 100`).bind(spaceId).all<EventRow>()).results

export const listDocumentEvents = async (documentId: string) =>
  (await env.DB.prepare(`SELECT ${columns} ${joins} WHERE e.document_id = ? ORDER BY e.at DESC LIMIT 100`).bind(documentId).all<EventRow>()).results

// The inbox: events by other people on documents and spaces this user belongs to, newest first.
// Nothing is written per event; "unseen" is everything after the time the bell was last opened.
const mine = `e.actor_id != ?1 AND (e.document_id IN (SELECT document_id FROM memberships WHERE user_id = ?1)
  OR e.space_id IN (SELECT space_id FROM space_memberships WHERE user_id = ?1))`

export const seenAt = async (userId: string) =>
  (await env.DB.prepare('SELECT seen_at FROM inbox_seen WHERE user_id = ?').bind(userId).first<{ seen_at: number }>())?.seen_at ?? 0

export const markSeen = (userId: string) =>
  env.DB.prepare('INSERT INTO inbox_seen (user_id, seen_at) VALUES (?1, ?2) ON CONFLICT DO UPDATE SET seen_at = ?2').bind(userId, Date.now()).run()

// `muted` are event types the person keeps out of the bell (Settings, Notifications).
const wanted = 'e.type NOT IN (SELECT value FROM json_each(?2))'

export const listInbox = async (userId: string, muted: string[] = []) =>
  (await env.DB.prepare(`SELECT ${columns} ${joins} WHERE ${mine} AND ${wanted} ORDER BY e.at DESC LIMIT 20`).bind(userId, JSON.stringify(muted)).all<EventRow>()).results

export const countUnseen = async (userId: string, since: number, muted: string[] = []) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM events e WHERE ${mine} AND ${wanted} AND e.at > ?3`).bind(userId, JSON.stringify(muted), since).first<{ n: number }>())?.n ?? 0
