import { env } from 'cloudflare:workers'

// Full-text search (SQLite FTS5 in D1). One row per document and kind: title, body, comments.
// Each writer replaces only its own row, so the text object and the threads object never collide.
const put = (documentId: string, kind: 'title' | 'body' | 'comments', text: string) =>
  env.DB.batch([
    env.DB.prepare('DELETE FROM search WHERE document_id = ? AND kind = ?').bind(documentId, kind),
    env.DB.prepare('INSERT INTO search (document_id, kind, text) VALUES (?, ?, ?)').bind(documentId, kind, text),
  ])

export const indexTitle = (id: string, title: string) => put(id, 'title', title)
export const indexBody = (id: string, text: string) => put(id, 'body', text)
export const indexComments = (id: string, text: string) => put(id, 'comments', text)
export const unindex = (id: string) => env.DB.prepare('DELETE FROM search WHERE document_id = ?').bind(id).run()

// Each word becomes a quoted prefix term, so "launc brie" finds "launch brief" and no input can be
// read as FTS syntax. Words are joined with AND.
export const ftsQuery = (q: string) => (q.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8).map((w) => `"${w}"*`).join(' ')

// The markers around a match in a snippet. Control characters, so no text can contain them.
export const MARK_START = '\u0002', MARK_END = '\u0003'

export type Hit = { document_id: string; kind: 'title' | 'body' | 'comments'; snippet: string }

// The best hit per document, among the documents this user can open.
export const searchHits = async (userId: string, q: string) => {
  const match = ftsQuery(q)
  if (!match) return []
  const { results } = await env.DB.prepare(
    `SELECT s.document_id, s.kind, snippet(search, 2, ?2, ?3, '…', 12) AS snippet FROM search s
     WHERE search MATCH ?1 AND s.document_id IN (
       SELECT d.id FROM documents d
       LEFT JOIN memberships m ON m.document_id = d.id AND m.user_id = ?4
       LEFT JOIN space_memberships sm ON sm.space_id = d.space_id AND sm.user_id = ?4
       WHERE m.user_id IS NOT NULL OR sm.user_id IS NOT NULL)
     ORDER BY rank LIMIT 200`,
  ).bind(match, MARK_START, MARK_END, userId).all<Hit>()
  const best = new Map<string, Hit>()
  for (const hit of results) if (!best.has(hit.document_id)) best.set(hit.document_id, hit)
  return [...best.values()]
}
