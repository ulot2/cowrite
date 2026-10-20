import { useEffect, useId, useRef, useState } from 'react'
import { emptyDecisionBrief, MAX_BRIEF_OPTIONS, validateDecisionBrief, type BriefOption, type DecisionBrief } from '~/lib/decision-brief'
import { DecisionBriefView, hasDecisionBrief } from './decision-brief-view'
import { Icon } from './icon'
import { Select } from './select'

const newOption = (): BriefOption => ({ id: crypto.randomUUID(), title: '', benefits: '', tradeoffs: '' })
export const briefDraft = (brief = emptyDecisionBrief()): DecisionBrief => ({ ...brief, options: brief.options.length ? brief.options.map((option) => ({ ...option })) : [newOption(), newOption()] })

export function DecisionBriefFields({ value, onChange, autoFocus = false }: { value: DecisionBrief; onChange: (value: DecisionBrief) => void; autoFocus?: boolean }) {
  const id = useId()
  const named = value.options.filter((option) => option.title.trim())
  const changeOption = (index: number, patch: Partial<BriefOption>) => onChange({ ...value, options: value.options.map((option, i) => i === index ? { ...option, ...patch } : option) })
  return <div className="brief-fields">
    <label htmlFor={`${id}-context`}>Context<span className="brief-field-hint">What needs to change, and why does it matter?</span><textarea id={`${id}-context`} autoFocus={autoFocus} rows={3} maxLength={3000} value={value.context} onChange={(event) => onChange({ ...value, context: event.target.value })} placeholder="The situation, constraints, and what a good outcome looks like." /></label>
    <fieldset className="brief-option-fields"><legend>Options</legend><p className="brief-field-hint">Give each approach a name, then compare what you gain and give up.</p>
      {value.options.map((option, index) => {
        const letter = String.fromCharCode(65 + index)
        return <div className="brief-option-editor" key={option.id}>
          <div className="brief-option-editor-head"><label htmlFor={`${id}-${option.id}-title`}>Option {letter}</label><button type="button" className="ghost icon-only" aria-label={`Remove option ${letter}`} title={`Remove option ${letter}`} onClick={() => onChange({ ...value, options: value.options.filter((row) => row.id !== option.id), recommendation: value.recommendation === option.id ? '' : value.recommendation, reasoning: value.recommendation === option.id ? '' : value.reasoning })}><Icon name="close" /></button></div>
          <input id={`${id}-${option.id}-title`} aria-label={`Option ${letter} name`} maxLength={160} value={option.title} placeholder="Name this approach" onChange={(event) => changeOption(index, { title: event.target.value })} />
          <div className="brief-comparison"><label>Benefits<textarea aria-label={`Option ${letter} benefits`} rows={2} maxLength={1000} value={option.benefits} placeholder="What works in its favor?" onChange={(event) => changeOption(index, { benefits: event.target.value })} /></label><label>Tradeoffs<textarea aria-label={`Option ${letter} tradeoffs`} rows={2} maxLength={1000} value={option.tradeoffs} placeholder="What would we give up or risk?" onChange={(event) => changeOption(index, { tradeoffs: event.target.value })} /></label></div>
        </div>
      })}
      <button type="button" className="ghost small" disabled={value.options.length >= MAX_BRIEF_OPTIONS} onClick={() => onChange({ ...value, options: [...value.options, newOption()] })}><Icon name="plus" />Add option</button>
      {value.options.length >= MAX_BRIEF_OPTIONS && <p className="brief-field-hint">Up to six options. Combine similar approaches to keep the comparison useful.</p>}
    </fieldset>
    <div className="brief-recommendation-fields"><span className="brief-field-label">Recommendation <span className="muted">(optional)</span></span>
      <Select key={named.map((option) => option.id).join(':')} name="briefRecommendation" label="Recommended option" defaultValue={named.some((option) => option.id === value.recommendation) ? value.recommendation : ''}
        options={[{ value: '', label: 'No recommendation yet' }, ...named.map((option) => ({ value: option.id, label: option.title }))]} onChange={(recommendation) => onChange({ ...value, recommendation, reasoning: recommendation ? value.reasoning : '' })} />
      {value.recommendation && <label>Why this option?<textarea aria-label="Why recommend this option?" rows={2} maxLength={1500} value={value.reasoning} onChange={(event) => onChange({ ...value, reasoning: event.target.value })} placeholder="Explain why it is the best fit for this decision." /></label>}
    </div>
  </div>
}

export function DecisionBriefPanel({ brief, canEdit, onSave, onEditingChange }: { brief: DecisionBrief; canEdit: boolean; onSave: (brief: DecisionBrief, original: DecisionBrief) => string | null; onEditingChange?: (editing: boolean) => void }) {
  const [draft, setDraft] = useState<DecisionBrief | null>(null)
  const original = useRef(brief)
  const trigger = useRef<HTMLButtonElement>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => () => onEditingChange?.(false), [onEditingChange])
  const begin = () => { original.current = brief; setDraft(briefDraft(brief)); setError(''); setMessage(''); onEditingChange?.(true) }
  const finish = () => { setDraft(null); setError(''); onEditingChange?.(false); requestAnimationFrame(() => trigger.current?.focus()) }
  if (!hasDecisionBrief(brief) && !canEdit) return null
  return <section className="decision-brief" aria-label="Decision brief">
    <div className="brief-heading"><div><h3>Decision brief</h3><p className="muted small">{hasDecisionBrief(brief) ? 'The context and choices behind this question.' : 'Lay out the context and choices before deciding.'}</p></div>{canEdit && !draft && <button ref={trigger} type="button" className="ghost small" onClick={begin}><Icon name={hasDecisionBrief(brief) ? 'suggest' : 'plus'} />{hasDecisionBrief(brief) ? 'Edit brief' : 'Add a brief'}</button>}</div>
    {draft && canEdit ? <form className="brief-edit-form" aria-label="Edit decision brief" onSubmit={(event) => {
      event.preventDefault()
      const invalid = validateDecisionBrief(draft) ?? onSave(draft, original.current)
      if (invalid) { setError(invalid); return }
      finish(); setMessage('Brief updated.')
    }}>
      <DecisionBriefFields value={draft} onChange={setDraft} autoFocus />
      {error && <div className="brief-save-error"><p className="error small" role="alert">{error}</p>{error.toLowerCase().includes('latest brief') && <button type="button" className="link-button small" onClick={begin}>Discard my draft and load latest</button>}</div>}
      <div className="form-actions"><button type="button" className="ghost" onClick={finish}>Cancel</button><button className="primary">Save brief</button></div>
    </form> : hasDecisionBrief(brief) ? <DecisionBriefView brief={brief} /> : <p className="muted small brief-empty">Add the situation, a few approaches, and a recommendation when you have one.</p>}
    {message && <p className="muted small" role="status">{message}</p>}
  </section>
}
