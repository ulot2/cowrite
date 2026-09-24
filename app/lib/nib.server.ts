import { env } from 'cloudflare:workers'
import { ask, readJson } from './ai.server'
import { spaceContext, type Source } from './search.server'
import { listMembers } from './access.server'

// Nib's work across a space: answer a question, propose next steps from a discussion, and check a
// document against the decisions in force. Prompts live in ai.server.ts; this file builds their
// inputs and reads their answers.

// A question about the space, answered from numbered sources it can cite.
export const askSpace = async (spaceId: string, question: string): Promise<{ answer: string; sources: Source[] }> => {
  const { sources, text } = await spaceContext(spaceId, question)
  if (!sources.length) return { answer: 'I could not find anything about that in this space.', sources }
  return { answer: await ask('space', question, text), sources }
}

export type Proposal = { tasks: { text: string; assignee: string; due: string }[]; decision: string | null }

const isDay = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'))

// Next steps from one discussion: tasks with an assignee (matched to a member by name) and a date,
// and what was decided, if anything. Nothing is created here; people accept each proposal.
export const proposeNextSteps = async (spaceId: string, discussionId: string): Promise<Proposal | null> => {
  const d = await env.DOC.get(env.DOC.idFromName(`${spaceId}:space`)).readDiscussion(discussionId)
  if (!d) return null
  const members = await listMembers('space', spaceId)
  const name = (id: string) => (id === 'ai' ? 'Nib' : members.find((m) => m.user_id === id)?.name ?? 'Someone')
  const thread = [`Title: ${d.title}`, ...d.posts.map((p) => `${name(p.userId)}: ${p.text}`)].join('\n')
  const context = `People: ${members.map((m) => m.name).join(', ')}\nToday: ${new Date().toISOString().slice(0, 10)}`
  const out = readJson(await ask('propose', thread, context)) as { tasks?: unknown; decision?: unknown } | null
  if (!out) throw new Error('Nib did not answer in the expected shape')
  const byName = (n: string) => {
    const want = n.trim().toLowerCase()
    return want ? members.find((m) => m.name.toLowerCase() === want || m.name.toLowerCase().split(/\s+/)[0] === want.split(/\s+/)[0])?.user_id ?? '' : ''
  }
  const tasks = (Array.isArray(out.tasks) ? out.tasks : []).flatMap((t) => {
    const x = (t ?? {}) as { text?: unknown; assignee?: unknown; due?: unknown }
    const text = typeof x.text === 'string' ? x.text.trim().slice(0, 300) : ''
    return text ? [{ text, assignee: typeof x.assignee === 'string' ? byName(x.assignee) : '', due: isDay(x.due) ? x.due : '' }] : []
  }).slice(0, 5)
  const decision = typeof out.decision === 'string' && out.decision.trim() && out.decision.trim().toLowerCase() !== 'null' ? out.decision.trim().slice(0, 1000) : null
  return { tasks, decision }
}

export type Finding = { kind: 'decision' | 'question'; text: string; href: string }

export const markCheckPending = (documentId: string) =>
  env.DB.prepare("UPDATE documents SET check_state = 'pending' WHERE id = ?").bind(documentId).run()

// Checks a document against the log it belongs to (its space's, or its owner's outside a space) and
// the space's open questions. Runs in the document's object, from its alarm. Writes the result to D1.
export const checkDocument = async (documentId: string, text: string) => {
  const save = (state: 'done' | 'failed', findings: Finding[] = []) =>
    env.DB.prepare('UPDATE documents SET check_state = ?, check_findings = ?, check_at = ? WHERE id = ?').bind(state, JSON.stringify(findings), Date.now(), documentId).run()
  try {
    const doc = await env.DB.prepare('SELECT space_id, owner_id FROM documents WHERE id = ?').bind(documentId).first<{ space_id: string | null; owner_id: string }>()
    if (!doc) return
    const decisions = (await env.DB.prepare(
      `SELECT x.id, x.number, x.text, x.outcome FROM decisions x WHERE ${doc.space_id ? 'x.space_id = ?' : 'x.space_id IS NULL AND x.owner_id = ?'} AND x.status = 'decided'
         AND NOT EXISTS (SELECT 1 FROM decisions r WHERE r.supersedes = x.id) ORDER BY x.number DESC LIMIT 60`,
    ).bind(doc.space_id ?? doc.owner_id).all<{ id: string; number: number; text: string; outcome: string }>()).results
    const questions = doc.space_id ? (await env.DB.prepare("SELECT id, title, due FROM discussions WHERE space_id = ? AND kind = 'question' AND status = 'open' LIMIT 30")
      .bind(doc.space_id).all<{ id: string; title: string; due: string | null }>()).results : []
    if (!text.trim() || (!decisions.length && !questions.length)) return save('done')
    const context = [
      'Decisions in force:', ...decisions.map((d) => `D-${d.number}: ${d.text}${d.outcome ? ` — ${d.outcome}` : ''}`),
      'Open questions:', ...questions.map((q) => `- ${q.title}${q.due ? ` (decide by ${q.due})` : ''}`),
    ].join('\n')
    const findings = (await ask('check', text, context)).split('\n').map((l) => l.replace(/^[-*•\s]+/, '').trim()).flatMap((line): Finding[] => {
      const dm = line.match(/^D-(\d+)\s*:\s*(.+)$/)
      const d = dm && decisions.find((x) => x.number === Number(dm[1]))
      if (d) return [{ kind: 'decision', text: dm[2], href: `/decision/${d.id}` }]
      const qm = line.match(/^Q\s*:\s*(.+)$/)
      const q = qm && questions.find((x) => qm[1].toLowerCase().startsWith(x.title.toLowerCase()))
      if (qm && q) return [{ kind: 'question', text: qm[1], href: `/space/${doc.space_id}?tab=discussions&d=${q.id}` }]
      return [] // "None found.", or a line that names no decision or question we know
    }).slice(0, 12)
    await save('done', findings)
  } catch (e) {
    console.error('Nib check failed', e)
    await save('failed')
  }
}
