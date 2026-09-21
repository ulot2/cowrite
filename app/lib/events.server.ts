import { env } from 'cloudflare:workers'

export type EventRow = { id: number; document_id: string | null; actor_id: string; actor: string; type: string; text: string; at: number; title: string | null }

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

const columns = 'e.id, e.document_id, e.actor_id, u.name AS actor, e.type, e.text, e.at, d.title'
const joins = 'FROM events e JOIN "user" u ON u.id = e.actor_id LEFT JOIN documents d ON d.id = e.document_id'

export const listSpaceEvents = async (spaceId: string) =>
  (await env.DB.prepare(`SELECT ${columns} ${joins} WHERE e.space_id = ? ORDER BY e.at DESC LIMIT 100`).bind(spaceId).all<EventRow>()).results

export const listDocumentEvents = async (documentId: string) =>
  (await env.DB.prepare(`SELECT ${columns} ${joins} WHERE e.document_id = ? ORDER BY e.at DESC LIMIT 100`).bind(documentId).all<EventRow>()).results
