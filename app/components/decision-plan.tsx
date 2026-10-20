import { useRef, useState } from 'react'
import { Link, useFetcher, useNavigate, useRevalidator, useSearchParams } from 'react-router'
import { initialPlanDraft, MAX_PLAN_TASKS, readPlanDraft, type LinkedPlan, type PlanDraft, type PlanPerson, type PlanSource, type PlanTask } from '~/lib/decision-plan'
import { Icon } from './icon'
import { Select } from './select'
import { PlanReviewPanel } from './plan-review'

// THESIS: the decision becomes reviewable work before anyone gets an assignment.
// OWN-WORLD: Studio's reading column, flat task rows and custom owner dropdowns.
// STORY: review the goal, name the work, choose owners/dates, then create.
// FIRST VIEWPORT: plans and progress follow the recorded outcome and reasoning.
// FORM: inline draft with explicit confirmation, retained errors and Cancel.
export function DecisionPlan({ source, reviewTarget, people, plans, canCreate, destination }: {
  source: PlanSource; reviewTarget: { id: string; version: string } | null; people: PlanPerson[]; plans: LinkedPlan[]; canCreate: boolean; destination: string
}) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const requested = params.get('review')
  const reviewing = plans.find((plan) => plan.id === requested)?.id ?? null
  const setReviewing = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('review', id); else next.delete('review')
    navigate({ search: next.toString() ? `?${next}` : '', hash: id ? `#plan-review-${id}` : '' }, { preventScrollReset: true, replace: !id })
  }
  const reviewTriggers = useRef(new Map<string, HTMLButtonElement>())
  const [draft, setDraft] = useState<PlanDraft | null>(null)
  const [error, setError] = useState('')
  const [request, setRequest] = useState('')
  const original = useRef(source)
  const trigger = useRef<HTMLButtonElement>(null)
  const fetcher = useFetcher<{ planError?: string; planRequest?: string }>()
  const revalidator = useRevalidator()
  const busy = fetcher.state !== 'idle'
  const begin = () => { original.current = source; setDraft(initialPlanDraft(source)); setRequest(crypto.randomUUID()); setError('') }
  const cancel = () => { setDraft(null); setError(''); requestAnimationFrame(() => trigger.current?.focus()) }
  const changeTask = (id: string, patch: Partial<PlanTask>) => setDraft((current) => current && ({ ...current, tasks: current.tasks.map((task) => task.id === id ? { ...task, ...patch } : task) }))
  const serverError = fetcher.data?.planRequest === request ? fetcher.data.planError : ''
  if (!canCreate && !plans.length && !draft && !requested) return null
  return <section className="decision-planning" aria-label="Plans for this decision">
    <div className="brief-heading"><div><h2>Put this decision into action</h2><p className="muted small">A plan keeps the goal, the work and the decision together.</p></div>
      {!draft && canCreate && <button ref={trigger} type="button" className="primary" onClick={begin}><Icon name="plan" />{plans.length ? 'Create another plan' : 'Create plan'}</button>}
    </div>
    {requested && !reviewing && <div className="plan-review-unavailable"><p className="muted small" role="status">This plan is no longer available here. It may have moved or your access may have changed.</p><button type="button" className="ghost small" onClick={() => setReviewing(null)}>Dismiss</button></div>}
    {plans.length > 0 && <><ul className="decision-plans">{plans.map((plan) => {
      const stale = !reviewTarget || (plan.reviewedDecisionId || plan.decisionId) !== reviewTarget.id || (plan.reviewedVersion || plan.version) !== reviewTarget.version
      return <li key={plan.id}>
      <div><Link to={`/doc/${plan.id}`}><Icon name="plan" /><strong>{plan.title}</strong></Link>{stale ? <span className="plan-earlier small">From an earlier version · needs review</span> : plan.reviewedAt && <span className="plan-earlier small">Reviewed by {plan.reviewedBy || 'a former member'} · {new Date(plan.reviewedAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>}
        <button ref={(node) => { if (node) reviewTriggers.current.set(plan.id, node); else reviewTriggers.current.delete(plan.id) }} type="button" className="ghost small plan-review-trigger" aria-expanded={reviewing === plan.id} aria-controls={`plan-review-${plan.id}`} onClick={() => setReviewing(reviewing === plan.id ? null : plan.id)}>{stale ? 'Review decision change' : plan.reviewedAt ? 'View review' : 'Review plan basis'}</button>
      </div>
      <div className="plan-progress"><span className="muted small">{plan.total ? `${plan.done} of ${plan.total} tasks done` : 'No tasks in this plan'}</span>{plan.total > 0 && <progress value={plan.done} max={plan.total} aria-label={`${plan.title}: ${plan.done} of ${plan.total} tasks done`} />}</div>
      {reviewing === plan.id && <PlanReviewPanel decisionId={plan.decisionId} planId={plan.id} onClose={() => { setReviewing(null); requestAnimationFrame(() => reviewTriggers.current.get(plan.id)?.focus()) }} />}
    </li>})}</ul><button className="ghost small" type="button" disabled={revalidator.state !== 'idle'} onClick={() => revalidator.revalidate()}><Icon name="history" />Refresh progress</button></>}
    {draft && <fetcher.Form method="post" className="decision-plan-form" aria-label="Review plan draft" onSubmit={(event) => {
      event.preventDefault()
      if (busy) return
      const parsed = readPlanDraft(draft)
      if (!parsed.draft) { setError(parsed.error); return }
      setError('')
      fetcher.submit({ intent: 'create-plan', request, version: original.current.version, draft: JSON.stringify(parsed.draft) }, { method: 'post' })
    }}>
      <fieldset disabled={busy}><legend>Review your plan draft</legend><p className="muted small plan-draft-note">Starter checklist for D-{original.current.number}. Edit it to fit the work. Nothing is created or assigned until you confirm.</p>
        <label>Plan title<input aria-label="Plan title" autoFocus maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label>Goal<textarea aria-label="Goal" rows={2} maxLength={1500} value={draft.goal} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} /></label>
        <label>Reasoning<textarea aria-label="Reasoning" rows={3} maxLength={3000} value={draft.why} onChange={(event) => setDraft({ ...draft, why: event.target.value })} placeholder="Why this plan supports the decision (optional)" /></label>
        <div className="plan-tasks-heading"><h3>Tasks</h3><span className="muted small">{draft.tasks.length} of {MAX_PLAN_TASKS}</span></div>
        <ol className="plan-draft-tasks">{draft.tasks.map((task, index) => <li key={task.id}>
          <div className="plan-task-title"><label>Task {index + 1}<input aria-label={`Task ${index + 1}`} maxLength={300} value={task.text} onChange={(event) => changeTask(task.id, { text: event.target.value })} /></label><button type="button" className="ghost icon-only" aria-label={`Remove task ${index + 1}`} onClick={() => setDraft({ ...draft, tasks: draft.tasks.filter((item) => item.id !== task.id) })}><Icon name="close" /></button></div>
          <div className="plan-task-fields"><div><p className="brief-field-label">Owner</p><Select name={`owner-${task.id}`} label={`Task ${index + 1} owner`} defaultValue={task.assignee} onChange={(assignee) => changeTask(task.id, { assignee })} options={[{ value: '', label: 'Unassigned' }, ...people.map((person) => ({ value: person.id, label: person.name }))]} /></div><label>Due date<input type="date" aria-label={`Task ${index + 1} due date`} value={task.due} onChange={(event) => changeTask(task.id, { due: event.target.value })} /></label></div>
        </li>)}</ol>
        <button type="button" className="ghost small" disabled={draft.tasks.length >= MAX_PLAN_TASKS} onClick={() => setDraft({ ...draft, tasks: [...draft.tasks, { id: crypto.randomUUID(), text: '', assignee: '', due: '' }] })}><Icon name="plus" />Add task</button>
        <p className="plan-confirmation muted small">Creates an editable document {destination}, links its tasks to D-{original.current.number}, and assigns the owners you selected. Leave an owner or date blank to decide later.</p>
        {(error || serverError) && <p className="error small" role="alert">{error || serverError}</p>}
        <div className="form-actions"><button type="button" className="ghost" onClick={cancel}>Cancel</button><button type="submit" className="primary" aria-busy={busy}>{busy ? 'Creating plan…' : 'Confirm and create plan'}</button></div>
      </fieldset>
    </fetcher.Form>}
  </section>
}
