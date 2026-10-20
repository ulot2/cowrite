import { useId, useRef, useState } from 'react'
import type { DecisionBrief, DecisionDraft } from '~/lib/decision-brief'
import { Select } from './select'

// THESIS: recording is an explicit final choice with its rationale and evidence.
// OWN-WORLD: Studio controls, flat fields and one cobalt primary action.
// STORY: choose, explain tradeoffs, preserve the brief, then record.
// FIRST VIEWPORT: an inline form immediately after the question's brief.
// FORM: custom dropdown, contextual comparison, Save/Cancel and retained errors.
export function RecordDecision({ brief, initialChoice = '', onRecord, onCancel }: {
  brief: DecisionBrief; initialChoice?: string
  onRecord: (draft: DecisionDraft, original: DecisionBrief) => string | null
  onCancel: () => void
}) {
  const original = useRef(brief).current
  const [optionId, setOptionId] = useState('')
  const [choice, setChoice] = useState(initialChoice)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const option = original.options.find((item) => item.id === optionId)
  return <form className="record-decision" aria-labelledby={`${id}-title`} onSubmit={(event) => {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setError(onRecord({ optionId, choice, reasoning: String(fields.get('reasoning') ?? '') }, original))
  }}>
    <div className="brief-heading"><div><h3 id={`${id}-title`}>Record the decision</h3><p className="muted small">Make the final choice and keep the reasoning with it.</p></div></div>
    {original.options.some((item) => item.title) && <div className="record-choice"><p className="brief-field-label">Final choice</p><Select name="option" label="Final choice" defaultValue="" onChange={setOptionId}
      options={[{ value: '', label: 'Another approach' }, ...original.options.filter((item) => item.title).map((item) => ({ value: item.id, label: item.title, hint: item.id === original.recommendation ? 'Recommended in the brief' : undefined }))]} /></div>}
    {option ? <div className="record-choice-detail"><strong>{option.title}</strong><dl className="brief-comparison">{option.benefits && <div><dt>Benefits</dt><dd>{option.benefits}</dd></div>}{option.tradeoffs && <div><dt>Tradeoffs to consider</dt><dd>{option.tradeoffs}</dd></div>}</dl></div>
      : <label>Final choice<textarea name="choice" rows={2} maxLength={1000} value={choice} onChange={(event) => setChoice(event.target.value)} placeholder="What did you decide to do?" autoFocus /></label>}
    <label>Final reasoning<textarea name="reasoning" rows={3} maxLength={3000} placeholder="Why did this choice win? Which tradeoffs are you accepting?" /></label>
    <p className="record-preserved muted small">The context, options and recommendation will be saved as they are now. Reopening keeps this version in the decision history.</p>
    {error && <p className="error small" role="alert">{error}</p>}
    <div className="form-actions"><button type="button" className="ghost" onClick={onCancel}>Cancel</button><button className="primary">Record decision</button></div>
  </form>
}
