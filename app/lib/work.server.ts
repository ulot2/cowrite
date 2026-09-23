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
  const scope = doc.space_id ? ['space_id = ?', doc.space_id] as const : ['space_id IS NULL AND owner_id = ?', doc.owner_id] as const
  let next = ((await env.DB.prepare(`SELECT MAX(number) AS n FROM decisions WHERE ${scope[0]}`).bind(scope[1]).first<{ n: number | null }>())?.n ?? 0) + 1
  const numbered: { id: string; number: number }[] = []
  writes.push(env.DB.prepare(`DELETE FROM decisions WHERE document_id = ?1 AND id NOT IN (SELECT value FROM json_each(?2))`).bind(documentId, JSON.stringify(decisions.map((d) => d.id))))
  for (const d of decisions) {
    const number = known.get(d.id) || d.number || next++
    if (number !== d.number) numbered.push({ id: d.id, number })
    writes.push(env.DB.prepare(
      `INSERT INTO decisions (id, document_id, space_id, owner_id, number, text, status, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(id) DO UPDATE SET document_id = ?2, space_id = ?3, text = ?6, status = ?7, updated_at = ?8`,
    ).bind(d.id, documentId, doc.space_id, doc.owner_id, number, d.text, d.status, now))
  }
  await env.DB.batch(writes)

  // A new or changed assignee hears about it through the bell.
  if (actorId) for (const t of tasks) if (t.assignee && t.assignee !== before.get(t.id) && t.assignee !== actorId)
    await logEvent(documentId, actorId, 'task', `assigned ${t.assigneeName || 'someone'} a task: “${t.text.slice(0, 80)}”`)
  return numbered
}

export const unindexWork = (documentId: string) => env.DB.batch([
  env.DB.prepare('DELETE FROM tasks WHERE document_id = ?').bind(documentId),
  env.DB.prepare('DELETE FROM decisions WHERE document_id = ?').bind(documentId),
])

export type TaskRow = { id: string; document_id: string; title: string; text: string; assignee_id: string | null; due: string | null; done: number }

// Tasks in documents this user can open. The page splits them into "assigned to me" and the rest.
export const listTasks = async (userId: string) =>
  (await env.DB.prepare(
    `SELECT t.id, t.document_id, d.title, t.text, t.assignee_id, t.due, t.done FROM tasks t JOIN documents d ON d.id = t.document_id
     LEFT JOIN memberships m ON m.document_id = d.id AND m.user_id = ?1
     LEFT JOIN space_memberships sm ON sm.space_id = d.space_id AND sm.user_id = ?1
     WHERE m.user_id IS NOT NULL OR sm.user_id IS NOT NULL
     ORDER BY t.done, t.due IS NULL, t.due, t.updated_at DESC LIMIT 500`,
  ).bind(userId).all<TaskRow>()).results

export const getTask = (id: string) => env.DB.prepare('SELECT id, document_id, assignee_id, text FROM tasks WHERE id = ?').bind(id).first<{ id: string; document_id: string; assignee_id: string | null; text: string }>()
export const setTaskDone = (id: string, done: boolean) => env.DB.prepare('UPDATE tasks SET done = ?, updated_at = ? WHERE id = ?').bind(done ? 1 : 0, Date.now(), id).run()

export type DecisionRow = { id: string; document_id: string; title: string; number: number; text: string; status: string; updated_at: number }

export const listSpaceDecisions = async (spaceId: string) =>
  (await env.DB.prepare(
    'SELECT x.id, x.document_id, d.title, x.number, x.text, x.status, x.updated_at FROM decisions x JOIN documents d ON d.id = x.document_id WHERE x.space_id = ? ORDER BY x.number DESC',
  ).bind(spaceId).all<DecisionRow>()).results
