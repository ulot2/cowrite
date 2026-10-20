import { env } from 'cloudflare:workers'
import { listMembers, roleOnDocument, roleOnSpace } from './access.server'
import { docStub } from './versions.server'
import { decisionPlanVersion, readPlanDraft, validPlanId, type LinkedPlan, type PlanSeed } from './decision-plan'
import { getDecision, type DecisionRecord } from './work.server'

export async function planPeople(decision: DecisionRecord) {
  return (await listMembers(decision.space_id ? 'space' : 'document', decision.space_id || decision.document_id)).map((person) => ({ id: person.user_id, name: person.name }))
}

export async function linkedDecisionPlans(user: string, decisionId: string): Promise<LinkedPlan[]> {
  const rows = (await env.DB.prepare(`WITH RECURSIVE ancestors(id, depth) AS (
    SELECT ?1, 0 UNION ALL SELECT d.supersedes, a.depth + 1 FROM decisions d JOIN ancestors a ON d.id = a.id WHERE d.supersedes IS NOT NULL AND a.depth < 99
    ) SELECT p.document_id AS id, d.title, p.decision_id AS decisionId, p.source_version AS version, COUNT(t.id) AS total, COALESCE(SUM(t.done), 0) AS done,
    r.source_version AS reviewedVersion, r.decision_id AS reviewedDecisionId, u.name AS reviewedBy, r.reviewed_at AS reviewedAt
    FROM decision_plans p JOIN documents d ON d.id = p.document_id LEFT JOIN tasks t ON t.document_id = d.id
    LEFT JOIN decision_plan_reviews r ON r.sequence = (SELECT MAX(sequence) FROM decision_plan_reviews WHERE document_id = p.document_id)
    LEFT JOIN "user" u ON u.id = r.reviewed_by
    WHERE p.decision_id IN (SELECT id FROM ancestors) GROUP BY p.document_id ORDER BY p.created_at DESC`).bind(decisionId).all<LinkedPlan>()).results
  const access = await Promise.all(rows.map(async (row) => {
    if (!await roleOnDocument(user, row.id)) return false
    if (row.decisionId === decisionId) return true
    const origin = await getDecision(row.decisionId)
    return origin && await (origin.space_id ? roleOnSpace(user, origin.space_id) : roleOnDocument(user, origin.document_id))
  }))
  return Promise.all(rows.filter((_, index) => access[index]).map(async (row) => {
    if (!row.reviewedDecisionId || row.reviewedDecisionId === decisionId) return row
    const reviewed = await getDecision(row.reviewedDecisionId)
    const visible = reviewed && await (reviewed.space_id ? roleOnSpace(user, reviewed.space_id) : roleOnDocument(user, reviewed.document_id))
    return visible ? row : { ...row, reviewedVersion: null, reviewedDecisionId: null, reviewedBy: null, reviewedAt: null }
  }))
}

// The same confirmation always addresses the same object, even after a network retry.
const planDocumentId = async (user: string, decision: string, request: string) => {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([user, decision, request]))))
  const hex = [...bytes.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function createDecisionPlan(user: string, decision: DecisionRecord, fields: FormData): Promise<{ id: string } | { error: string }> {
  const request = String(fields.get('request') ?? '')
  if (!validPlanId(request)) return { error: 'Open a fresh plan draft and try again.' }
  const existing = await env.DB.prepare('SELECT document_id AS id FROM decision_plans WHERE decision_id = ? AND created_by = ? AND request_id = ?')
    .bind(decision.id, user, request).first<{ id: string }>()
  if (existing) return await roleOnDocument(user, existing.id) ? existing : { error: 'This plan was already created, but you no longer have access to it.' }
  if (decision.status !== 'decided' || decision.replaced_by) return { error: 'Create a plan from a decided, current decision. Review this decision before continuing.' }
  const version = decisionPlanVersion(decision)
  if (fields.get('version') !== version) return { error: 'The decision changed while you were planning. Your draft is still here; cancel and review the latest decision before creating a plan.' }
  const live = await docStub(decision.source_type === 'discussion' ? `${decision.space_id}:space` : decision.document_id)
    .readPlanSource(decision.source_type, decision.source_type === 'discussion' ? decision.source_id || '' : decision.id)
  if ((!live && decision.source_type === 'document') || (live && (live.status !== 'decided' || live.recordingId !== decision.recording_id || live.choice !== (decision.outcome || decision.text))))
    return { error: 'The source decision just changed. Your draft is still here; cancel and review the latest decision before creating a plan.' }
  let raw: unknown
  try { raw = JSON.parse(String(fields.get('draft') ?? '')) } catch { return { error: 'Review the plan draft before creating it.' } }
  const parsed = readPlanDraft(raw)
  if (!parsed.draft) return { error: parsed.error }
  const people = await planPeople(decision), allowed = new Set(people.map((person) => person.id))
  if (parsed.draft.tasks.some((task) => task.assignee && !allowed.has(task.assignee))) return { error: 'A task owner is no longer a member. Choose an available person or leave the task unassigned.' }
  const rationale = decision.recording_id ? await env.DB.prepare('SELECT payload FROM decision_recordings WHERE decision_id = ? AND id = ?').bind(decision.id, decision.recording_id).first<{ payload: string }>() : null
  const source = { decisionId: decision.id, number: decision.number, text: decision.text, choice: decision.outcome || decision.text, reasoning: rationale ? String(JSON.parse(rationale.payload).reasoning ?? '') : '', version }
  // A failed attempt may leave only an unpublished seed. Editing that draft is
  // a new confirmation payload, so it must not reuse the old tasks or owners.
  const id = await planDocumentId(user, decision.id, JSON.stringify([request, version, parsed.draft]))
  // Seal a seed before publishing a document row. Retries reuse the first confirmed
  // payload and task ids. Until the D1 batch succeeds this object has no readers.
  const seed: PlanSeed = await docStub(id).seedDecisionPlan({ source, draft: { ...parsed.draft, tasks: parsed.draft.tasks.map((task) => ({ ...task, id: crypto.randomUUID() })) }, people })
  if (seed.source.version !== version || seed.draft.tasks.some((task) => task.assignee && !allowed.has(task.assignee))) return { error: 'The earlier confirmation no longer matches this decision or its members. Cancel and open a fresh plan draft.' }
  const now = Date.now(), names = new Map(seed.people.map((person) => [person.id, person.name]))
  const planOwner = decision.space_id ? user : decision.owner_id
  const writes = [
    env.DB.prepare(`INSERT INTO documents (id, title, kind, owner_id, space_id, created_at, updated_at)
      SELECT ?1, ?2, 'doc', ?3, space_id, ?4, ?4 FROM decisions
      WHERE id = ?5 AND status = 'decided' AND recording_id IS ?6 AND text = ?7 AND outcome = ?8 AND decided_at IS ?9 AND space_id IS ?10 AND owner_id = ?11
        AND NOT EXISTS (SELECT 1 FROM decisions newer WHERE newer.supersedes = ?5)`)
      .bind(id, seed.draft.title, planOwner, now, decision.id, decision.recording_id, decision.text, decision.outcome, decision.decided_at, decision.space_id, decision.owner_id),
    env.DB.prepare("INSERT INTO memberships (document_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, planOwner),
    ...(!decision.space_id ? [env.DB.prepare(`INSERT INTO memberships (document_id, user_id, role)
      SELECT ?1, user_id, role FROM memberships WHERE document_id = ?2 AND user_id != ?3`).bind(id, decision.document_id, planOwner)] : []),
    env.DB.prepare('INSERT INTO decision_plans (document_id, decision_id, created_by, request_id, source_version, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, decision.id, user, request, version, now),
    ...seed.draft.tasks.map((task) => env.DB.prepare('INSERT INTO tasks (id, document_id, text, assignee_id, due, done, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
      .bind(task.id, id, task.text, task.assignee || null, task.due || null, now)),
    ...[`document:${id}`, ...seed.draft.tasks.map((task) => `task:${task.id}`)].map((target) => env.DB.prepare("INSERT INTO work_links (id, source, target, relation, created_by, created_at) VALUES (?, ?, ?, 'implements', ?, ?)")
      .bind(crypto.randomUUID(), `decision:${decision.id}`, target, user, now)),
    env.DB.prepare("INSERT INTO search (document_id, kind, text) VALUES (?, 'title', ?)").bind(id, seed.draft.title),
    env.DB.prepare("INSERT INTO events (space_id, document_id, actor_id, type, text, at) VALUES (?, ?, ?, 'created', ?, ?)")
      .bind(decision.space_id, id, user, `created “${seed.draft.title}” from D-${decision.number}`, now),
    ...seed.draft.tasks.filter((task) => task.assignee && task.assignee !== user).map((task) => env.DB.prepare("INSERT INTO events (space_id, document_id, actor_id, type, text, at) VALUES (?, ?, ?, 'task', ?, ?)")
      .bind(decision.space_id, id, user, `assigned ${names.get(task.assignee) || 'someone'} a task: “${task.text.slice(0, 80)}”`, now)),
  ]
  try { await env.DB.batch(writes) } catch (error) {
    const completed = await env.DB.prepare('SELECT document_id AS id FROM decision_plans WHERE decision_id = ? AND created_by = ? AND request_id = ?').bind(decision.id, user, request).first<{ id: string }>()
    if (completed) return completed
    console.error('Decision plan creation failed', error)
    return { error: 'The plan could not be created. Your draft is still here. Check that this decision is current, then try again.' }
  }
  return { id }
}
