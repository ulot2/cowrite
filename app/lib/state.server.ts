import { env } from 'cloudflare:workers'
import { ask } from './ai.server'
import { listSpaceEvents } from './events.server'

// The state of a space. The facts are cheap queries, run on every load of its home. Nib's summary of
// them costs a model call, so it is saved on the space row and written again only when it is due.

const WEEK = 7 * 864e5
export const STATE_EVERY = 6 * 3600e3 // a summary is due again after this, if something happened
export const REFRESH_EVERY = 10 * 60e3 // the Refresh link, at most this often per space

const today = () => new Date().toISOString().slice(0, 10)

export type SpaceState = {
  decided: { id: string; number: number; text: string }[]
  questions: { open: number; late: number; next: { id: string; title: string; due: string | null; owner: string | null } | null }
  lateTasks: { id: string; text: string; due: string; assignee: string | null; discussion_id: string | null; document_id: string }[]
  review: { id: string; title: string; concerns: number }[]
  fresh: { documents: number; discussions: number; ideas: number }
}

export const spaceState = async (spaceId: string): Promise<SpaceState> => {
  const since = Date.now() - WEEK
  const decided = (await env.DB.prepare("SELECT id, number, text FROM decisions WHERE space_id = ? AND status = 'decided' AND decided_at > ? ORDER BY number DESC LIMIT 10")
    .bind(spaceId, since).all<{ id: string; number: number; text: string }>()).results
  const q = (await env.DB.prepare(
    `SELECT d.id, d.title, d.due, u.name AS owner FROM discussions d LEFT JOIN "user" u ON u.id = d.owner_id
     WHERE d.space_id = ? AND d.kind = 'question' AND d.status = 'open' ORDER BY d.due IS NULL, d.due`,
  ).bind(spaceId).all<{ id: string; title: string; due: string | null; owner: string | null }>()).results
  const lateTasks = (await env.DB.prepare(
    `SELECT t.id, t.text, t.due, u.name AS assignee, t.discussion_id, t.document_id FROM tasks t LEFT JOIN documents doc ON doc.id = t.document_id LEFT JOIN "user" u ON u.id = t.assignee_id
     WHERE t.done = 0 AND t.due IS NOT NULL AND t.due < ?2 AND (doc.space_id = ?1 OR t.space_id = ?1) ORDER BY t.due LIMIT 20`,
  ).bind(spaceId, today()).all<SpaceState['lateTasks'][number]>()).results
  const review = (await env.DB.prepare(
    `SELECT d.id, d.title, (SELECT COUNT(*) FROM signoffs s WHERE s.document_id = d.id AND s.state = 'concern') AS concerns
     FROM documents d WHERE d.space_id = ? AND d.status = 'review' ORDER BY d.updated_at DESC`,
  ).bind(spaceId).all<SpaceState['review'][number]>()).results
  const counts = (await env.DB.prepare(
    `SELECT SUM(type = 'created') AS documents, SUM(type = 'discussion' AND (text LIKE 'started a discussion%' OR text LIKE 'asked %')) AS discussions,
       SUM(type = 'idea') AS ideas FROM events WHERE space_id = ? AND at > ?`,
  ).bind(spaceId, since).first<{ documents: number | null; discussions: number | null; ideas: number | null }>())
  return {
    decided,
    questions: { open: q.length, late: q.filter((x) => x.due && x.due < today()).length, next: q[0] ?? null },
    lateTasks, review,
    fresh: { documents: counts?.documents ?? 0, discussions: counts?.discussions ?? 0, ideas: counts?.ideas ?? 0 },
  }
}

export type SavedState = { text: string; at: number | null; state: 'pending' | 'done' | 'failed' | null }
export const getSavedState = async (spaceId: string): Promise<SavedState> => {
  const row = await env.DB.prepare('SELECT state_text, state_at, state_state FROM spaces WHERE id = ?').bind(spaceId).first<{ state_text: string; state_at: number | null; state_state: SavedState['state'] }>()
  return { text: row?.state_text ?? '', at: row?.state_at ?? null, state: row?.state_state ?? null }
}

// Due when there is no summary yet, or it is older than STATE_EVERY and something happened since.
export const stateDue = async (spaceId: string, saved: SavedState) => {
  if (saved.state === 'pending') return false
  if (!saved.at) return true
  if (Date.now() - saved.at < STATE_EVERY) return false
  const last = await env.DB.prepare('SELECT MAX(at) AS at FROM events WHERE space_id = ?').bind(spaceId).first<{ at: number | null }>()
  return (last?.at ?? 0) > saved.at
}

export const markStatePending = (spaceId: string) =>
  env.DB.prepare("UPDATE spaces SET state_state = 'pending' WHERE id = ?").bind(spaceId).run()

// Nib's summary: the facts as short lines, then the recent activity. Runs in the space room's alarm.
// A failure keeps the last summary and says so; the facts on the page stay live either way.
export const writeState = async (spaceId: string) => {
  try {
    const s = await spaceState(spaceId)
    const events = (await listSpaceEvents(spaceId)).slice(0, 40)
    const facts = [
      `Today: ${today()}`,
      `Decided in the last 7 days: ${s.decided.length ? s.decided.map((d) => `D-${d.number} ${d.text}`).join('; ') : 'nothing'}`,
      `Open questions: ${s.questions.open}, of which late: ${s.questions.late}${s.questions.next ? `. Next: "${s.questions.next.title}"${s.questions.next.owner ? `, ${s.questions.next.owner} decides` : ''}${s.questions.next.due ? ` by ${s.questions.next.due}` : ''}` : ''}`,
      `Late tasks: ${s.lateTasks.length ? s.lateTasks.map((t) => `"${t.text}" (${t.assignee ?? 'nobody'}, due ${t.due})`).join('; ') : 'none'}`,
      `Waiting for review: ${s.review.length ? s.review.map((d) => `"${d.title}"${d.concerns ? ` with ${d.concerns} open concern(s)` : ''}`).join('; ') : 'none'}`,
      `New in the last 7 days: ${s.fresh.documents} documents, ${s.fresh.discussions} discussions, ${s.fresh.ideas} ideas`,
      'Recent activity, newest first:',
      ...events.map((e) => `- ${new Date(e.at).toISOString().slice(0, 10)} ${e.actor} ${e.text}${e.title ? ` (${e.title})` : ''}`),
    ].join('\n')
    const text = await ask('state', facts)
    await env.DB.prepare("UPDATE spaces SET state_text = ?, state_at = ?, state_state = 'done' WHERE id = ?").bind(text.slice(0, 2000), Date.now(), spaceId).run()
  } catch (e) {
    console.error('State of the space failed', e)
    await env.DB.prepare("UPDATE spaces SET state_state = 'failed', state_at = ? WHERE id = ?").bind(Date.now(), spaceId).run()
  }
}
