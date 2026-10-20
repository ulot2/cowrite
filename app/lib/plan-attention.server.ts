import { env } from 'cloudflare:workers'
import { roleOnDocument, roleOnSpace } from './access.server'
import { decisionPlanVersion } from './decision-plan'
import { currentPlanDecision } from './plan-reviews.server'
import { getDecision, type DecisionRecord } from './work.server'
import { atLeast, rank, type Role } from './roles'

type Candidate = {
  id: string; title: string; originId: string; version: string; spaceId: string | null; space: string | null
  reviewedId: string | null; reviewedVersion: string | null; directRole: Role | null; spaceRole: Role | null; visibility: string | null
}

// A derived queue: no dismissal state to drift from the source decision or review history.
// Cache decisions, chain resolutions and permissions within this request, including plans
// sharing one decision. This reads the index only; visiting Home never starts document rooms.
export async function pendingPlanReviews(user: string, spaceId?: string) {
  const candidates = (await env.DB.prepare(`SELECT d.id, d.title, p.decision_id AS originId, p.source_version AS version,
      d.space_id AS spaceId, s.name AS space, m.role AS directRole, sm.role AS spaceRole, s.visibility,
      r.decision_id AS reviewedId, r.source_version AS reviewedVersion
    FROM decision_plans p JOIN documents d ON d.id = p.document_id
    LEFT JOIN spaces s ON s.id = d.space_id
    LEFT JOIN memberships m ON m.document_id = d.id AND m.user_id = ?1
    LEFT JOIN space_memberships sm ON sm.space_id = d.space_id AND sm.user_id = ?1
    LEFT JOIN decision_plan_reviews r ON r.sequence = (SELECT MAX(sequence) FROM decision_plan_reviews WHERE document_id = d.id)
    WHERE m.role IS NOT NULL OR sm.role IS NOT NULL OR s.visibility = 'public'
    ORDER BY p.created_at DESC, d.id`).bind(user).all<Candidate>()).results
  const decisions = new Map<string, ReturnType<typeof getDecision>>()
  const roles = new Map<string, Promise<Role | null>>()
  const targets = new Map<string, Promise<DecisionRecord | null>>()
  const read: typeof getDecision = (id) => {
    if (!decisions.has(id)) decisions.set(id, getDecision(id))
    return decisions.get(id)!
  }
  const role = (decision: DecisionRecord) => {
    const key = decision.space_id ? `space:${decision.space_id}` : `doc:${decision.document_id}`
    if (!roles.has(key)) roles.set(key, decision.space_id ? roleOnSpace(user, decision.space_id) : roleOnDocument(user, decision.document_id))
    return roles.get(key)!
  }
  const rows = await Promise.all(candidates.map(async (plan) => {
    const origin = await read(plan.originId)
    if (!origin) return null
    if (!targets.has(origin.id)) targets.set(origin.id, currentPlanDecision(user, origin, { read, role }))
    const current = await targets.get(origin.id)!
    if (!current) return null
    if (spaceId && ![plan.spaceId, origin.space_id, current.space_id].includes(spaceId)) return null
    // The review endpoint also requires access to the most recent saved basis.
    if (plan.reviewedId) {
      const previous = await read(plan.reviewedId)
      if (!previous || !await role(previous)) return null
    }
    if ((plan.reviewedId || origin.id) === current.id && (plan.reviewedVersion || plan.version) === decisionPlanVersion(current)) return null
    const [originRole, targetRole] = await Promise.all([role(origin), role(current)])
    const inherited = plan.spaceRole || (plan.visibility === 'public' ? 'viewer' : null)
    const planRole = rank(plan.directRole) > rank(inherited) ? plan.directRole : inherited
    const canConfirm = current.status === 'decided' && atLeast(planRole, 'editor') && atLeast(originRole, 'editor') && atLeast(targetRole, 'editor')
    // Home is personal. The space overview also includes readable team work.
    if (!spaceId && !canConfirm) return null
    const state = current.status === 'decided' ? 'Decision changed' : current.status === 'reopened' ? 'Decision reopened · waiting for an outcome' : 'Waiting for a decided outcome'
    return {
      id: plan.id, title: plan.title, canConfirm, waitingForDecision: current.status !== 'decided',
      detail: `D-${current.number}: ${current.text} · ${state}`,
      space: plan.space || current.space_name || origin.space_name,
      to: `/decision/${encodeURIComponent(current.id)}?${new URLSearchParams({ review: plan.id })}#plan-review-${plan.id}`,
    }
  }))
  return rows.filter((row) => row !== null)
}
