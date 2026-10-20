import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher, useRevalidator } from 'react-router'
import type { PlanReview, PlanSource } from '~/lib/decision-plan'
import { Icon } from './icon'

// THESIS: a changed decision earns a human review before its plan is called current.
// OWN-WORLD: Studio type, flat comparison columns and hairline review history.
// STORY: compare the choices, edit the real plan if needed, then acknowledge.
// FIRST VIEWPORT: previous basis and current choice sit above the edit/confirm actions.
// FORM: inline disclosure, explicit review outcome, recoverable errors and a dated receipt.
const date = (at: number) => new Date(at).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })

function ReviewSource({ source, title }: { source: PlanSource; title: string }) {
  return <section><h4>{title}</h4><Link to={`/decision/${source.decisionId}`} className="small">D-{source.number}</Link><p className="plan-review-choice">{source.choice}</p>
    <h5>Reasoning</h5><p>{source.reasoning || 'No separate reasoning was recorded for this version.'}</p></section>
}

export function PlanReviewPanel({ decisionId, planId, onClose }: { decisionId: string; planId: string; onClose: () => void }) {
  const fetcher = useFetcher<{ review?: PlanReview; error?: string; saved?: boolean }>()
  const revalidator = useRevalidator()
  const [review, setReview] = useState<PlanReview | null>(null)
  const [outcome, setOutcome] = useState('')
  const [note, setNote] = useState('')
  const [checked, setChecked] = useState(false)
  const [receipt, setReceipt] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const endpoint = `/api/plan-review?${new URLSearchParams({ decision: decisionId, plan: planId })}`
  useEffect(() => { fetcher.load(endpoint); heading.current?.focus() }, [endpoint])
  useEffect(() => {
    if (!fetcher.data?.review) return
    setReview(fetcher.data.review)
    if (fetcher.data.saved !== undefined) { setReceipt(true); revalidator.revalidate() }
  }, [fetcher.data])
  const busy = fetcher.state !== 'idle'
  const reload = () => { setReceipt(false); setChecked(false); setOutcome(''); fetcher.load(endpoint) }
  return <div className="plan-review-panel" id={`plan-review-${planId}`} aria-labelledby={`plan-review-title-${planId}`}>
    <div className="brief-heading"><h3 id={`plan-review-title-${planId}`} ref={heading} tabIndex={-1}>Review decision change</h3><button type="button" className="ghost small" onClick={onClose} disabled={busy}>Close review</button></div>
    {!review && busy && <p className="muted small" role="status">Loading the decision comparison…</p>}
    {review && <>
      <p className="muted small">{review.sequence ? 'Compare the last reviewed decision with the current one.' : 'Compare the decision used to create this plan with the current one.'} Review the goal and tasks in <strong>{review.plan.title}</strong> before confirming.</p>
      <div className="plan-review-comparison"><ReviewSource source={review.baseline} title={review.sequence ? 'Last reviewed basis' : 'Original plan basis'} /><ReviewSource source={review.current} title="Current decision" /></div>
      {review.blocked && <p className="plan-review-warning small" role="status">{review.blocked}</p>}
      <div className="plan-review-open"><a href={`/doc/${planId}`} target="_blank" rel="noreferrer" className="button ghost"><Icon name="docs" />Open plan to review or edit<Icon name="open" /></a><span className="muted small">Opens in a new tab. Return here after your edits have synced.</span></div>
      {review.currentReviewed ? <div className="plan-review-receipt" role="status"><Icon name="check" /><div><strong>{receipt ? 'Review complete' : 'Plan is current with this decision'}</strong><p className="small muted">{review.history[0] ? `${review.history[0].outcome === 'updated' ? 'Plan updated' : 'Plan still applies'} · ${review.history[0].by} · ${date(review.history[0].at)}` : 'This is the decision version used to create the plan.'}</p></div></div> : review.canConfirm && !review.blocked ? <fetcher.Form method="post" action="/api/plan-review" className="plan-review-form" onSubmit={(event) => {
        event.preventDefault()
        if (busy) return
        fetcher.submit({ decision: decisionId, plan: planId, target: review.current.decisionId, version: review.current.version, sequence: String(review.sequence), outcome, note, checked: String(checked) }, { method: 'post', action: '/api/plan-review' })
      }}><fieldset disabled={busy}><legend>How does the plan fit now?</legend>
        <label className="plan-review-option"><input type="radio" name="review-outcome" value="unchanged" required checked={outcome === 'unchanged'} onChange={() => setOutcome('unchanged')} /><span><strong>Plan still applies</strong><span className="muted small">The goal and tasks already support the current decision.</span></span></label>
        <label className="plan-review-option"><input type="radio" name="review-outcome" value="updated" required checked={outcome === 'updated'} onChange={() => setOutcome('updated')} /><span><strong>I updated the plan</strong><span className="muted small">I edited the goal or tasks in the plan document.</span></span></label>
        <label className="plan-review-note">{outcome === 'updated' ? 'What did you change?' : 'Review note (optional)'}<textarea rows={2} maxLength={2000} required={outcome === 'updated'} value={note} onChange={(event) => setNote(event.target.value)} placeholder={outcome === 'updated' ? 'Describe the changes you made in the plan.' : 'Why does the existing plan still fit?'} /></label>
        <label className="plan-review-option small"><input type="checkbox" required checked={checked} onChange={(event) => setChecked(event.target.checked)} /><span>I reviewed the plan goal and tasks against the current decision.</span></label>
        <p className="muted small">Confirming saves your review of D-{review.current.number}. It does not edit the plan or reassign tasks.</p>
        <div className="form-actions"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={!checked || !outcome} aria-busy={busy}>{busy ? 'Saving review…' : 'Confirm plan review'}</button></div>
      </fieldset></fetcher.Form> : !review.canConfirm && <p className="muted small">An editor of the plan and its decisions can confirm this review.</p>}
      {review.history.length > 0 && <details className="plan-review-history" data-disclosure><summary>Review history <span className="muted small">{review.history.length === 20 ? 'Latest 20' : review.history.length}</span><Icon name="chevron" /></summary><ol>{review.history.map((entry) => <li key={entry.sequence}><div><strong>{entry.outcome === 'updated' ? 'Plan updated' : 'Plan still applies'}</strong><span className="muted small">{entry.by} · <time dateTime={new Date(entry.at).toISOString()}>{date(entry.at)}</time> · D-{entry.source.number}</span></div>{entry.note && <p>{entry.note}</p>}<details data-disclosure><summary>Decision reviewed</summary><p>{entry.source.choice}</p><p className="muted">{entry.source.reasoning || 'No separate reasoning recorded.'}</p></details></li>)}</ol></details>}
    </>}
    {fetcher.data?.error && <div className="plan-review-error"><p className="error small" role="alert">{fetcher.data.error}</p><button type="button" className="ghost small" disabled={busy} onClick={reload}>Reload comparison</button></div>}
  </div>
}
