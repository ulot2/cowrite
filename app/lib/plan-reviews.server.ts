import { env } from 'cloudflare:workers'
import { roleOnDocument, roleOnSpace } from './access.server'
import { atLeast, type Role } from './roles'
import { decisionPlanVersion, validPlanId, type PlanReview, type PlanReviewEntry, type PlanSource } from './decision-plan'
import { docStub } from './versions.server'
import { getDecision, type DecisionRecord } from './work.server'

const decisionRole = (user: string, decision: DecisionRecord) => decision.space_id
  ? roleOnSpace(user, decision.space_id) : roleOnDocument(user, decision.document_id)

// Follow replacement decisions only while every record remains visible to this reader.
export async function currentPlanDecision(user: string, origin: DecisionRecord, lookup?: {
  read: typeof getDecision; role: (decision: DecisionRecord) => Promise<Role | null>
}): Promise<DecisionRecord | null> {
  let current = origin
  const seen = new Set<string>()
  for (let step = 0; step < 100; step++) {
    if (seen.has(current.id) || !await (lookup ? lookup.role(current) : decisionRole(user, current))) return null
    seen.add(current.id)
    if (!current.replaced_by) return current
    const next = await (lookup?.read ?? getDecision)(current.replaced_by)
    if (!next) return null
    current = next
  }
  return null
}

// source_version is the original, immutable decision snapshot, not the editable plan text.
async function sourceAtVersion(decision: DecisionRecord, version: string): Promise<PlanSource> {
  const [recordingId, text, outcome] = JSON.parse(version) as [string | null, string, string]
  const row = recordingId ? await env.DB.prepare('SELECT payload FROM decision_recordings WHERE decision_id = ? AND id = ?')
    .bind(decision.id, recordingId).first<{ payload: string }>() : null
  return { decisionId: decision.id, number: decision.number, text, choice: outcome || text, reasoning: row ? String(JSON.parse(row.payload).reasoning ?? '') : '', version }
}

export const planReviewSource = (decision: DecisionRecord) => sourceAtVersion(decision, decisionPlanVersion(decision))

async function reviewContext(user: string, decisionId: string, planId: string) {
  const origin = await getDecision(decisionId)
  const [originRole, planRole] = await Promise.all([origin ? decisionRole(user, origin) : null, roleOnDocument(user, planId)])
  if (!origin || !originRole || !planRole) throw new Response('Not found', { status: 404 })
  const plan = await env.DB.prepare(`SELECT p.document_id AS id, d.title, p.source_version AS version
    FROM decision_plans p JOIN documents d ON d.id = p.document_id WHERE p.document_id = ? AND p.decision_id = ?`)
    .bind(planId, decisionId).first<{ id: string; title: string; version: string }>()
  if (!plan) throw new Response('Not found', { status: 404 })
  const current = await currentPlanDecision(user, origin)
  if (!current) throw new Response('The current decision is unavailable. Ask a space owner to check its replacement.', { status: 403 })
  const targetRole = current.id === origin.id ? originRole : await decisionRole(user, current)
  return { origin, current, plan, canEdit: atLeast(originRole, 'editor') && atLeast(targetRole, 'editor') && atLeast(planRole, 'editor') }
}

export async function loadPlanReview(user: string, decisionId: string, planId: string): Promise<PlanReview> {
  const { origin, current, plan, canEdit } = await reviewContext(user, decisionId, planId)
  const rows = (await env.DB.prepare(`SELECT r.sequence, r.source_snapshot, r.outcome, r.note, r.reviewed_at, u.name
    FROM decision_plan_reviews r LEFT JOIN "user" u ON u.id = r.reviewed_by WHERE r.document_id = ? ORDER BY r.sequence DESC LIMIT 20`)
    .bind(plan.id).all<{ sequence: number; source_snapshot: string; outcome: 'unchanged' | 'updated'; note: string; reviewed_at: number; name: string | null }>()).results
  // A replacement can later move to a private space. Do not reveal its saved text through history.
  const history: PlanReviewEntry[] = []
  for (const row of rows) {
    const source = JSON.parse(row.source_snapshot) as PlanSource
    const decision = await getDecision(source.decisionId)
    if (!decision || !await decisionRole(user, decision)) continue
    history.push({ sequence: row.sequence, source, outcome: row.outcome, note: row.note, by: row.name || 'Former member', at: row.reviewed_at })
  }
  const latest = rows[0]
  const latestVisible = latest && history.find((entry) => entry.sequence === latest.sequence)
  if (latest && !latestVisible) throw new Response('The previous review is no longer available to you.', { status: 403 })
  const [baseline, source] = await Promise.all([latestVisible ? latestVisible.source : sourceAtVersion(origin, plan.version), planReviewSource(current)])
  const currentReviewed = baseline.decisionId === source.decisionId && baseline.version === source.version
  return {
    plan: { id: plan.id, title: plan.title }, baseline, current: source, sequence: latest?.sequence ?? 0, history,
    currentReviewed, canConfirm: canEdit,
    blocked: current.status !== 'decided' ? 'This decision is open or dropped. Wait until a current decision is recorded before confirming the plan.' : null,
  }
}

export async function confirmPlanReview(user: string, fields: FormData): Promise<{ review: PlanReview; saved: boolean } | { error: string }> {
  const originId = String(fields.get('decision') ?? ''), planId = String(fields.get('plan') ?? '')
  if (!validPlanId(planId) || !originId || originId.length > 250) return { error: 'Open the plan review again and try once more.' }
  const { origin, current, canEdit } = await reviewContext(user, originId, planId)
  if (!canEdit) throw new Response('Only people who can edit both the plan and its decisions can confirm a review.', { status: 403 })
  const review = await loadPlanReview(user, originId, planId)
  const version = String(fields.get('version') ?? ''), target = String(fields.get('target') ?? '')
  if (target !== current.id || version !== review.current.version) return { error: 'The decision changed during your review. Reload the comparison and review the latest choice before confirming.' }
  if (review.blocked) return { error: review.blocked }
  const outcome = String(fields.get('outcome') ?? ''), note = String(fields.get('note') ?? '').trim()
  if (!['unchanged', 'updated'].includes(outcome) || fields.get('checked') !== 'true') return { error: 'Review the plan goal and tasks, then choose how the plan supports this decision.' }
  if (note.length > 2000 || (outcome === 'updated' && !note)) return { error: outcome === 'updated' && !note ? 'Describe what you changed in the plan before confirming.' : 'Keep your review note within 2,000 characters.' }
  if (review.currentReviewed) return { review, saved: false }
  if (String(review.sequence) !== fields.get('sequence')) return { error: 'Someone else reviewed this plan. Reload the comparison before continuing.' }
  // Check the live room too: D1 can lag a reopen or a newly recorded decision.
  const live = await docStub(current.source_type === 'discussion' ? `${current.space_id}:space` : current.document_id)
    .readPlanSource(current.source_type, current.source_type === 'discussion' ? current.source_id || '' : current.id)
  if (!live || live.status !== 'decided' || live.recordingId !== current.recording_id || live.choice !== (current.outcome || current.text))
    return { error: 'The source decision just changed. Reload the comparison once the latest decision is recorded.' }
  // The insert is a compare-and-set against both the source and the last review.
  // Checking the chain in the same statement prevents acknowledging a detached replacement.
  const result = await env.DB.prepare(`WITH RECURSIVE chain(id) AS (
      SELECT ?1 UNION SELECT d.id FROM decisions d JOIN chain c ON d.supersedes = c.id
    ) INSERT OR IGNORE INTO decision_plan_reviews
      (document_id, decision_id, source_version, source_snapshot, previous_sequence, outcome, note, reviewed_by, reviewed_at)
    SELECT ?2, id, ?3, ?4, ?5, ?6, ?7, ?8, ?9 FROM decisions
    WHERE id = ?10 AND id IN (SELECT id FROM chain) AND status = 'decided' AND recording_id IS ?11
      AND text = ?12 AND outcome = ?13 AND decided_at IS ?14 AND space_id IS ?15 AND owner_id = ?16
      AND NOT EXISTS (SELECT 1 FROM decisions WHERE supersedes = ?10)
      AND COALESCE((SELECT MAX(sequence) FROM decision_plan_reviews WHERE document_id = ?2), 0) = ?5
      AND EXISTS (SELECT 1 FROM decision_plans WHERE document_id = ?2 AND decision_id = ?1)`)
    .bind(origin.id, planId, version, JSON.stringify(review.current), review.sequence, outcome, note, user, Date.now(), current.id,
      current.recording_id, current.text, current.outcome, current.decided_at, current.space_id, current.owner_id).run()
  const updated = await loadPlanReview(user, originId, planId)
  if (!result.meta.changes && !updated.currentReviewed) return { error: 'The decision or its review changed. Reload the comparison before confirming.' }
  return { review: updated, saved: !!result.meta.changes }
}
