import { env } from 'cloudflare:workers'
import { logEvent } from './events.server'

// Tasks and decisions live in documents. These rows are an index of them, rewritten by the object's
// alarm, so the Tasks page and the decision log can list them across documents.
export type WorkItem =
  | { kind: 'task'; id: string; text: string; assignee: string | null; assigneeName: string; due: string | null; done: boolean }
  | { kind: 'decision'; id: string; text: string; status: string; number: number }

// Writes this document's rows. Returns the decisions that just got a number, to write into the blocks.
export const syncWork = async (documentId: string, items: WorkItem[], actorId: string | null) => {
  const doc = await env.DB.prepare('SELECT space_id, owner_id FROM documents WHERE id = ?').bind(documentId).first<{ space_id: string | null; owner_id: string }>()
  if (!doc) return []
  const now = Date.now()
  const tasks = items.filter((i) => i.kind === 'task')
  const decisions = items.filter((i) => i.kind === 'decision')

  // Tasks: who was assigned before, to tell the new assignee.
  const before = new Map((await env.DB.prepare('SELECT id, assignee_id FROM tasks WHERE document_id = ?').bind(documentId).all<{ id: string; assignee_id: string | null }>()).results.map((r) => [r.id, r.assignee_id]))
  const writes = [
    env.DB.prepare(`DELETE FROM tasks WHERE document_id = ?1 AND id NOT IN (SELECT value FROM json_each(?2))`).bind(documentId, JSON.stringify(tasks.map((t) => t.id))),
    ...tasks.map((t) => env.DB.prepare(
      `INSERT INTO tasks (id, document_id, text, assignee_id, due, done, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET document_id = ?2, text = ?3, assignee_id = ?4, due = ?5, done = ?6, updated_at = ?7`,
    ).bind(t.id, documentId, t.text, t.assignee, t.due, t.done ? 1 : 0, now)),
  ]

  // Decisions: a number once, from the space's log (or the owner's, outside a space), never reused.
  // ponytail: two documents numbering at the same instant can share a number; a counter row fixes it.
  const known = new Map((await env.DB.prepare('SELECT id, number FROM decisions WHERE document_id = ?').bind(documentId).all<{ id: string; number: number }>()).results.map((r) => [r.id, r.number]))
  let next = await nextDecisionNumber(doc.space_id, doc.owner_id)
  const numbered: { id: string; number: number }[] = []
  writes.push(env.DB.prepare(`DELETE FROM decisions WHERE document_id = ?1 AND id NOT IN (SELECT value FROM json_each(?2))`).bind(documentId, JSON.stringify(decisions.map((d) => d.id))))
  for (const d of decisions) {
    const number = known.get(d.id) || d.number || next++
    if (number !== d.number) numbered.push({ id: d.id, number })
    // Who decided and when: set the first time the status turns "decided", cleared if it turns back.
    writes.push(env.DB.prepare(
      `INSERT INTO decisions (id, document_id, space_id, owner_id, number, text, status, updated_at, source_type, source_id, decided_by, decided_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'document', ?2, CASE WHEN ?7 = 'decided' THEN ?9 END, CASE WHEN ?7 = 'decided' THEN ?8 END)
       ON CONFLICT(id) DO UPDATE SET document_id = ?2, space_id = ?3, text = ?6, status = ?7, updated_at = ?8, source_id = ?2,
         decided_by = CASE WHEN ?7 = 'decided' THEN COALESCE(decided_by, ?9) END, decided_at = CASE WHEN ?7 = 'decided' THEN COALESCE(decided_at, ?8) END`,
    ).bind(d.id, documentId, doc.space_id, doc.owner_id, number, d.text, d.status, now, actorId))
  }
  await env.DB.batch(writes)

  // A new or changed assignee hears about it through the bell.
  if (actorId) for (const t of tasks) if (t.assignee && t.assignee !== before.get(t.id) && t.assignee !== actorId)
    await logEvent(documentId, actorId, 'task', `assigned ${t.assigneeName || 'someone'} a task: “${t.text.slice(0, 80)}”`)
  return numbered
}

// The next free decision number: per space, or per owner for documents outside a space.
// ponytail: two writers numbering at the same instant can share a number; a counter row fixes it.
export const nextDecisionNumber = async (spaceId: string | null, ownerId: string) => {
  const [where, value] = spaceId ? ['space_id = ?', spaceId] : ['space_id IS NULL AND owner_id = ?', ownerId]
  return ((await env.DB.prepare(`SELECT MAX(number) AS n FROM decisions WHERE ${where}`).bind(value).first<{ n: number | null }>())?.n ?? 0) + 1
}

export const unindexWork = (documentId: string) => env.DB.batch([
  env.DB.prepare('DELETE FROM tasks WHERE document_id = ?').bind(documentId),
  env.DB.prepare('DELETE FROM decisions WHERE document_id = ?').bind(documentId),
])

export type TaskRow = { id: string; document_id: string; title: string; text: string; assignee_id: string | null; due: string | null; done: number; space_id: string | null; discussion_id: string | null }

// Tasks in documents and space discussions this user can open. The page splits them into
// "assigned to me" and the rest. A discussion task has no document; its space decides who sees it.
export const listTasks = async (userId: string) =>
  (await env.DB.prepare(
    `SELECT t.id, t.document_id, COALESCE(d.title, dis.title, '') AS title, t.text, t.assignee_id, t.due, t.done, t.space_id, t.discussion_id FROM tasks t
     LEFT JOIN documents d ON d.id = t.document_id
     LEFT JOIN discussions dis ON dis.id = t.discussion_id
     LEFT JOIN memberships m ON m.document_id = d.id AND m.user_id = ?1
     LEFT JOIN space_memberships sm ON sm.space_id = COALESCE(d.space_id, t.space_id) AND sm.user_id = ?1
     WHERE (d.id IS NOT NULL OR t.discussion_id IS NOT NULL) AND (m.user_id IS NOT NULL OR sm.user_id IS NOT NULL)
     ORDER BY t.done, t.due IS NULL, t.due, t.updated_at DESC LIMIT 500`,
  ).bind(userId).all<TaskRow>()).results

export const getTask = (id: string) => env.DB.prepare('SELECT id, document_id, space_id, discussion_id, assignee_id, text FROM tasks WHERE id = ?').bind(id).first<{ id: string; document_id: string; space_id: string | null; discussion_id: string | null; assignee_id: string | null; text: string }>()
export const setTaskDone = (id: string, done: boolean) => env.DB.prepare('UPDATE tasks SET done = ?, updated_at = ? WHERE id = ?').bind(done ? 1 : 0, Date.now(), id).run()

export type DecisionRow = {
  id: string; number: number; text: string; outcome: string; status: string; source_type: 'document' | 'discussion'; source_id: string | null
  document_id: string; title: string; decided_at: number | null; updated_at: number; supersedes: string | null
  replaced_by: string | null; replaced_by_number: number | null
}

// A space's log, newest first. "Replaced by" comes from the newer decision's supersedes link.
export const listSpaceDecisions = async (spaceId: string) =>
  (await env.DB.prepare(
    `SELECT x.id, x.number, x.text, x.outcome, x.status, x.source_type, x.source_id, x.document_id, COALESCE(d.title, '') AS title, x.decided_at, x.updated_at, x.supersedes,
       r.id AS replaced_by, r.number AS replaced_by_number
     FROM decisions x LEFT JOIN documents d ON d.id = x.document_id LEFT JOIN decisions r ON r.supersedes = x.id
     WHERE x.space_id = ? ORDER BY x.number DESC`,
  ).bind(spaceId).all<DecisionRow>()).results

export type DecisionRecord = DecisionRow & {
  space_id: string | null; space_name: string | null; owner_id: string; decided_by: string | null; decided_by_name: string | null
  supersedes_number: number | null; supersedes_text: string | null; replaced_at: number | null; document_status: string | null
}

export const getDecision = (id: string) => env.DB.prepare(
  `SELECT x.id, x.number, x.text, x.outcome, x.status, x.source_type, x.source_id, x.document_id, COALESCE(d.title, '') AS title, x.decided_at, x.updated_at,
     x.supersedes, x.space_id, s.name AS space_name, x.owner_id, x.decided_by, u.name AS decided_by_name, d.status AS document_status,
     o.number AS supersedes_number, o.text AS supersedes_text,
     r.id AS replaced_by, r.number AS replaced_by_number, r.decided_at AS replaced_at
   FROM decisions x LEFT JOIN documents d ON d.id = x.document_id LEFT JOIN spaces s ON s.id = x.space_id LEFT JOIN "user" u ON u.id = x.decided_by
     LEFT JOIN decisions o ON o.id = x.supersedes LEFT JOIN decisions r ON r.supersedes = x.id
   WHERE x.id = ?`,
).bind(id).first<DecisionRecord>()

// Decisions this one could replace: the others in the same log that nothing else replaces yet.
export const replaceableDecisions = async (d: { id: string; space_id: string | null; owner_id: string }) =>
  (await env.DB.prepare(
    `SELECT x.id, x.number, x.text FROM decisions x WHERE x.id != ?1 AND ${d.space_id ? 'x.space_id = ?2' : 'x.space_id IS NULL AND x.owner_id = ?2'}
       AND NOT EXISTS (SELECT 1 FROM decisions r WHERE r.supersedes = x.id AND r.id != ?1) ORDER BY x.number DESC`,
  ).bind(d.id, d.space_id ?? d.owner_id).all<{ id: string; number: number; text: string }>()).results

// Walks the chain from `older` back through what it replaces; true when `id` is on it (a cycle).
export const wouldCycle = async (id: string, older: string) => {
  for (let at: string | null = older, steps = 0; at && steps < 100; steps++) {
    if (at === id) return true
    at = (await env.DB.prepare('SELECT supersedes FROM decisions WHERE id = ?').bind(at).first<{ supersedes: string | null }>())?.supersedes ?? null
  }
  return false
}

export const setSupersedes = (id: string, older: string | null) =>
  env.DB.prepare('UPDATE decisions SET supersedes = ? WHERE id = ?').bind(older, id).run()
