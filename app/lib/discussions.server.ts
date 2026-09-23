import { env } from 'cloudflare:workers'
import { logSpaceEvent } from './events.server'

// What a space room's alarm reads out of its Yjs data. The room is the source; these go to D1.
export type DiscussionItem = {
  id: string; title: string; kind: 'talk' | 'question'; status: 'open' | 'answered' | 'closed'
  owner: string | null; due: string | null; posts: number; lastAt: number; lastBy: string | null
  createdBy: string; answer: string; answeredBy: string | null
}
export type SpaceTaskItem = { id: string; text: string; assignee: string | null; assigneeName: string; due: string | null; done: boolean; discussionId: string; createdBy: string }

const quote = (s: string) => `“${s.slice(0, 80)}”`
const day = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })

// A reply within 30 minutes of the same person's last reply in the same space moves that event
// forward instead of adding one, like edits do.
const touchSpaceEvent = async (spaceId: string, actorId: string, text: string) => {
  const now = Date.now()
  const { meta } = await env.DB.prepare(
    "UPDATE events SET at = ?1, text = ?2 WHERE id = (SELECT id FROM events WHERE space_id = ?3 AND document_id IS NULL AND actor_id = ?4 AND type = 'discussion' AND text LIKE 'replied in%' AND at > ?5 ORDER BY at DESC LIMIT 1)",
  ).bind(now, text, spaceId, actorId, now - 30 * 60 * 1000).run()
  if (meta.changes === 0) await logSpaceEvent(spaceId, actorId, 'discussion', text)
}

// Rewrites this space's rows and logs what changed since the last run: new discussions and
// questions, replies, answers, closes, and task assignments.
export const syncDiscussions = async (spaceId: string, items: DiscussionItem[], tasks: SpaceTaskItem[]) => {
  if (!(await env.DB.prepare('SELECT 1 FROM spaces WHERE id = ?').bind(spaceId).first())) return
  const before = new Map((await env.DB.prepare('SELECT id, status, posts FROM discussions WHERE space_id = ?').bind(spaceId).all<{ id: string; status: string; posts: number }>()).results.map((r) => [r.id, r]))
  const assigned = new Map((await env.DB.prepare('SELECT id, assignee_id FROM tasks WHERE space_id = ? AND discussion_id IS NOT NULL').bind(spaceId).all<{ id: string; assignee_id: string | null }>()).results.map((r) => [r.id, r.assignee_id]))
  await env.DB.batch([
    env.DB.prepare('DELETE FROM discussions WHERE space_id = ?1 AND id NOT IN (SELECT value FROM json_each(?2))').bind(spaceId, JSON.stringify(items.map((d) => d.id))),
    ...items.map((d) => env.DB.prepare(
      `INSERT INTO discussions (id, space_id, title, kind, status, owner_id, due, posts, last_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(id) DO UPDATE SET title = ?3, kind = ?4, status = ?5, owner_id = ?6, due = ?7, posts = ?8, last_at = ?9`,
    ).bind(d.id, spaceId, d.title, d.kind, d.status, d.owner, d.due, d.posts, d.lastAt, d.createdBy)),
    env.DB.prepare('DELETE FROM tasks WHERE space_id = ?1 AND discussion_id IS NOT NULL AND id NOT IN (SELECT value FROM json_each(?2))').bind(spaceId, JSON.stringify(tasks.map((t) => t.id))),
    ...tasks.map((t) => env.DB.prepare(
      `INSERT INTO tasks (id, document_id, space_id, discussion_id, text, assignee_id, due, done, updated_at) VALUES (?1, '', ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(id) DO UPDATE SET text = ?4, assignee_id = ?5, due = ?6, done = ?7, updated_at = ?8`,
    ).bind(t.id, spaceId, t.discussionId, t.text, t.assignee, t.due, t.done ? 1 : 0, Date.now())),
  ])

  for (const d of items) {
    const was = before.get(d.id)
    if (!was) await logSpaceEvent(spaceId, d.createdBy, 'discussion', d.kind === 'question' ? `asked ${quote(d.title)}${d.due ? ` (decide by ${day(d.due)})` : ''}` : `started a discussion: ${quote(d.title)}`)
    else if (d.posts > was.posts && d.lastBy) await touchSpaceEvent(spaceId, d.lastBy, `replied in ${quote(d.title)}`)
    if (was && was.status !== d.status && d.status === 'answered' && d.answeredBy) await logSpaceEvent(spaceId, d.answeredBy, 'discussion', `answered ${quote(d.title)}: ${quote(d.answer)}`)
  }
  for (const t of tasks) if (t.assignee && t.assignee !== assigned.get(t.id) && t.assignee !== t.createdBy)
    await logSpaceEvent(spaceId, t.createdBy, 'task', `assigned ${t.assigneeName || 'someone'} a task: ${quote(t.text)}`)
}

export const unindexSpace = (spaceId: string) => env.DB.batch([
  env.DB.prepare('DELETE FROM discussions WHERE space_id = ?').bind(spaceId),
  env.DB.prepare('DELETE FROM tasks WHERE space_id = ? AND discussion_id IS NOT NULL').bind(spaceId),
])

export type QuestionRow = { id: string; title: string; owner_id: string | null; owner: string | null; due: string | null; posts: number; last_at: number }
export type DiscussionRow = QuestionRow & { kind: string; status: string }

// For the space home: questions still waiting for an answer (earliest deadline first), and the
// latest discussions of any kind.
export const listOpenQuestions = async (spaceId: string) =>
  (await env.DB.prepare(
    `SELECT d.id, d.title, d.owner_id, u.name AS owner, d.due, d.posts, d.last_at FROM discussions d LEFT JOIN "user" u ON u.id = d.owner_id
     WHERE d.space_id = ? AND d.kind = 'question' AND d.status = 'open' ORDER BY d.due IS NULL, d.due, d.last_at DESC`,
  ).bind(spaceId).all<QuestionRow>()).results

export const listRecentDiscussions = async (spaceId: string, limit = 5) =>
  (await env.DB.prepare(
    `SELECT d.id, d.title, d.kind, d.status, d.owner_id, u.name AS owner, d.due, d.posts, d.last_at FROM discussions d LEFT JOIN "user" u ON u.id = d.owner_id
     WHERE d.space_id = ? ORDER BY d.last_at DESC LIMIT ?`,
  ).bind(spaceId, limit).all<DiscussionRow>()).results

export type SpaceTaskRow = { id: string; text: string; assignee_id: string | null; assignee: string | null; due: string | null; document_id: string; discussion_id: string | null; source: string }

// Open tasks of a space: from its documents and from its discussions.
export const listSpaceTasks = async (spaceId: string) =>
  (await env.DB.prepare(
    `SELECT t.id, t.text, t.assignee_id, u.name AS assignee, t.due, t.document_id, t.discussion_id, COALESCE(doc.title, dis.title, '') AS source
     FROM tasks t LEFT JOIN documents doc ON doc.id = t.document_id LEFT JOIN discussions dis ON dis.id = t.discussion_id LEFT JOIN "user" u ON u.id = t.assignee_id
     WHERE t.done = 0 AND (doc.space_id = ?1 OR t.space_id = ?1) ORDER BY t.due IS NULL, t.due LIMIT 50`,
  ).bind(spaceId).all<SpaceTaskRow>()).results
