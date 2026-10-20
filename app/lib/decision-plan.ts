export type PlanTask = { id: string; text: string; assignee: string; due: string }
export type PlanDraft = { title: string; goal: string; why: string; tasks: PlanTask[] }
export type PlanPerson = { id: string; name: string }
export type PlanSource = { decisionId: string; number: number; text: string; choice: string; reasoning: string; version: string }
export type PlanSeed = { source: PlanSource; draft: PlanDraft; people: PlanPerson[] }
export type LinkedPlan = { id: string; title: string; total: number; done: number; version: string }
export const MAX_PLAN_TASKS = 12
export const validPlanId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

export const decisionPlanVersion = (decision: { recording_id: string | null; text: string; outcome: string; status: string; decided_at: number | null; replaced_by: string | null }) =>
  JSON.stringify([decision.recording_id, decision.text, decision.outcome, decision.status, decision.decided_at, decision.replaced_by])

export const initialPlanDraft = (source: PlanSource): PlanDraft => ({
  title: `Plan: ${source.text}`.slice(0, 120), goal: source.choice || source.text, why: source.reasoning,
  tasks: ['Prepare the first deliverable', 'Review the work with the team', 'Put the decision into practice'].map((text) => ({ id: crypto.randomUUID(), text, assignee: '', due: '' })),
})

export function readPlanDraft(value: unknown): { draft: PlanDraft; error?: never } | { error: string; draft?: never } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Review the plan draft before creating it.' }
  const raw = value as Record<string, unknown>
  if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.trim().length > 120) return { error: 'Give the plan a title of up to 120 characters.' }
  if (typeof raw.goal !== 'string' || !raw.goal.trim() || raw.goal.trim().length > 1500) return { error: 'Describe the goal in up to 1,500 characters.' }
  if (typeof raw.why !== 'string' || raw.why.trim().length > 3000) return { error: 'Keep the reasoning within 3,000 characters.' }
  if (!Array.isArray(raw.tasks) || !raw.tasks.length || raw.tasks.length > MAX_PLAN_TASKS) return { error: `Add between 1 and ${MAX_PLAN_TASKS} tasks.` }
  const tasks: PlanTask[] = [], seen = new Set<string>()
  for (const value of raw.tasks) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Check each task in the draft.' }
    const task = value as Record<string, unknown>
    if (typeof task.id !== 'string' || !validPlanId(task.id) || seen.has(task.id)) return { error: 'Each task needs its own identifier. Remove the duplicate and add a new task.' }
    if (typeof task.text !== 'string' || !task.text.trim() || task.text.trim().length > 300) return { error: 'Give each task a description of up to 300 characters.' }
    if (typeof task.assignee !== 'string' || task.assignee.length > 200) return { error: 'Choose a task owner from the available people.' }
    if (typeof task.due !== 'string') return { error: 'Use a valid due date, or leave it blank.' }
    if (task.due && (!/^\d{4}-\d{2}-\d{2}$/.test(task.due) || !Number.isFinite(Date.parse(`${task.due}T00:00:00Z`)) || new Date(`${task.due}T00:00:00Z`).toISOString().slice(0, 10) !== task.due)) return { error: 'Use a valid due date, or leave it blank.' }
    seen.add(task.id); tasks.push({ id: task.id, text: task.text.trim(), assignee: task.assignee, due: task.due })
  }
  return { draft: { title: raw.title.trim(), goal: raw.goal.trim(), why: raw.why.trim(), tasks } }
}
