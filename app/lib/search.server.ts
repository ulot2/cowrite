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

// A question matches any of its words (OR), without the words every sentence has. FTS5 ranks the
// rows with more and rarer matches first.
const common = new Set('a an and are as at be but by can did do does for from has have how i in is it its of on or our so that the their them then there these they this to was we were what when where which who why will with you your'.split(' '))
export const ftsAny = (q: string) => [...new Set((q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !common.has(w)))].slice(0, 12).map((w) => `"${w}"*`).join(' OR ')

// A space room's own rows: its discussions and its ideas, keyed "s:<space id>:...", so the documents
// search (which matches real document ids only) never sees them. Rewritten whole on every change.
// ponytail: a full rewrite per change; per discussion if a space gets hundreds of threads.
export const indexSpace = (spaceId: string, rows: { key: string; text: string }[]) =>
  env.DB.batch([
    env.DB.prepare('DELETE FROM search WHERE document_id LIKE ?').bind(`s:${spaceId}:%`),
    ...rows.map((r) => env.DB.prepare("INSERT INTO search (document_id, kind, text) VALUES (?, 'space', ?)").bind(`s:${spaceId}:${r.key}`, r.text)),
  ])

export type Source = { n: number; kind: 'decision' | 'question' | 'document' | 'discussion' | 'ideas'; title: string; href: string }

// The text around the first word of the question that appears in it.
const around = (text: string, q: string, size = 2000) => {
  const lower = text.toLowerCase()
  const at = Math.min(...(q.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).map((w) => lower.indexOf(w)).filter((i) => i >= 0), text.length)
  const start = at >= text.length ? 0 : Math.max(0, at - size / 4)
  return (start > 0 ? '…' : '') + text.slice(start, start + size) + (start + size < text.length ? '…' : '')
}

// What Nib reads to answer a question about a space: the decisions in force, the open questions,
// then the best matches among its documents, discussions, and ideas. Numbered, so the answer can
// cite them; cut at `budget` characters.
export const spaceContext = async (spaceId: string, question: string, budget = 12000) => {
  const sources: Source[] = []
  const parts: string[] = []
  const add = (s: Omit<Source, 'n'>, body: string) => {
    const n = sources.length + 1
    const part = `[${n}] ${body}`
    if (parts.join('\n\n').length + part.length > budget) return false
    sources.push({ n, ...s }); parts.push(part)
    return true
  }
  const decisions = (await env.DB.prepare(
    `SELECT x.id, x.number, x.text, x.outcome FROM decisions x WHERE x.space_id = ? AND x.status = 'decided'
       AND NOT EXISTS (SELECT 1 FROM decisions r WHERE r.supersedes = x.id) ORDER BY x.number DESC LIMIT 40`,
  ).bind(spaceId).all<{ id: string; number: number; text: string; outcome: string }>()).results
  for (const d of decisions) add({ kind: 'decision', title: `D-${d.number}: ${d.text}`, href: `/decision/${d.id}` }, `Decision D-${d.number}, in force: ${d.text}${d.outcome ? ` — ${d.outcome}` : ''}`)
  const questions = (await env.DB.prepare("SELECT id, title, due FROM discussions WHERE space_id = ? AND kind = 'question' AND status = 'open' ORDER BY due IS NULL, due LIMIT 20")
    .bind(spaceId).all<{ id: string; title: string; due: string | null }>()).results
  for (const q of questions) add({ kind: 'question', title: q.title, href: `/space/${spaceId}?tab=discussions&d=${q.id}` }, `Open question, not decided yet: ${q.title}${q.due ? ` (decide by ${q.due})` : ''}`)

  const match = ftsAny(question)
  if (match) {
    const { results } = await env.DB.prepare(
      `SELECT s.document_id, s.text FROM search s WHERE search MATCH ?1 AND (s.document_id IN (SELECT id FROM documents WHERE space_id = ?2) OR s.document_id LIKE ?3) ORDER BY rank LIMIT 40`,
    ).bind(match, spaceId, `s:${spaceId}:%`).all<{ document_id: string; text: string }>()
    const ids = [...new Set(results.map((r) => r.document_id))].slice(0, 5)
    for (const id of ids) {
      if (id.startsWith('s:')) {
        const key = id.slice(spaceId.length + 3)
        const text = results.find((r) => r.document_id === id)!.text
        if (key === 'ideas') add({ kind: 'ideas', title: 'Ideas board', href: `/space/${spaceId}?tab=ideas` }, `The ideas board:\n${around(text, question)}`)
        else {
          const title = text.split('\n')[0]
          add({ kind: 'discussion', title, href: `/space/${spaceId}?tab=discussions&d=${key.slice(2)}` }, `Discussion "${title}":\n${around(text, question)}`)
        }
        continue
      }
      const doc = await env.DB.prepare("SELECT d.title, s.text FROM documents d LEFT JOIN search s ON s.document_id = d.id AND s.kind = 'body' WHERE d.id = ?").bind(id).first<{ title: string; text: string | null }>()
      if (doc) add({ kind: 'document', title: doc.title, href: `/doc/${id}` }, `Document "${doc.title}":\n${around(doc.text ?? '', question)}`)
    }
  }
  return { sources, text: parts.join('\n\n') }
}
