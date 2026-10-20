import * as Y from 'yjs'

export type BriefOption = { id: string; title: string; benefits: string; tradeoffs: string }
export type DecisionBrief = { context: string; options: BriefOption[]; recommendation: string; reasoning: string }
export const MAX_BRIEF_OPTIONS = 6
export const emptyDecisionBrief = (): DecisionBrief => ({ context: '', options: [], recommendation: '', reasoning: '' })
export type DecisionRecording = { id: string; title: string; choice: string; optionId: string; reasoning: string; brief: DecisionBrief; by: string; at: number; legacy?: boolean }
export type DecisionDraft = { optionId: string; choice: string; reasoning: string }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.trim().slice(0, limit) : ''

// Bound data read from the shared room. Older discussions simply have no brief.
export function readDecisionBrief(value: unknown): DecisionBrief {
  const raw = record(value instanceof Y.Map ? value.toJSON() : value)
  const rows = Array.isArray(raw.options) ? raw.options : Object.entries(record(raw.options))
    .sort(([a, av], [b, bv]) => (Number(record(av).position) || 0) - (Number(record(bv).position) || 0) || a.localeCompare(b))
    .map(([id, option]) => ({ ...record(option), id }))
  const seen = new Set<string>()
  const options = rows.flatMap((value): BriefOption[] => {
    const option = record(value), id = text(option.id, 100)
    if (!id || seen.has(id)) return []
    seen.add(id)
    const row = { id, title: text(option.title, 160), benefits: text(option.benefits, 1000), tradeoffs: text(option.tradeoffs, 1000) }
    return row.title || row.benefits || row.tradeoffs ? [row] : []
  }).slice(0, MAX_BRIEF_OPTIONS)
  const recommendation = options.some((option) => option.id === raw.recommendation && option.title) ? String(raw.recommendation) : ''
  return { context: text(raw.context, 3000), options, recommendation, reasoning: recommendation ? text(raw.reasoning, 1500) : '' }
}

export function validateDecisionBrief(brief: DecisionBrief): string | null {
  if (brief.options.some((option) => !option.title.trim() && (option.benefits.trim() || option.tradeoffs.trim()))) return 'Give each option a name, or remove its details.'
  if (brief.recommendation && !brief.options.some((option) => option.id === brief.recommendation && option.title.trim())) return 'Choose a recommendation from the named options.'
  if (brief.recommendation && !brief.reasoning.trim()) return 'Explain why you recommend this option.'
  return null
}

export function decisionBriefText(brief: DecisionBrief): string {
  return [brief.context && `Context: ${brief.context}`, ...brief.options.map((option) => `Option: ${option.title}\nBenefits: ${option.benefits}\nTradeoffs: ${option.tradeoffs}`),
    brief.recommendation && `Recommendation: ${brief.options.find((option) => option.id === brief.recommendation)?.title}\nWhy: ${brief.reasoning}`].filter(Boolean).join('\n')
}

// A single plain value makes the choice, rationale and brief one atomic Yjs write.
// D1 retains the first payload for each recording id, including after reopening.
export function readDecisionRecording(value: unknown): DecisionRecording | null {
  if (typeof value === 'string') { try { value = JSON.parse(value) } catch { return null } }
  const raw = record(value), brief = readDecisionBrief(raw.brief)
  const id = text(raw.id, 100), choice = text(raw.choice, 1000), reasoning = text(raw.reasoning, 3000), by = text(raw.by, 200)
  const legacy = raw.legacy === true
  if (!id || !choice || (!reasoning && !legacy) || !by || !Number.isSafeInteger(raw.at) || Number(raw.at) < (legacy ? 0 : 1)) return null
  const optionId = text(raw.optionId, 100)
  if (optionId && !brief.options.some((option) => option.id === optionId && option.title === choice)) return null
  return { id, title: text(raw.title, 200), choice, optionId, reasoning, brief, by, at: Number(raw.at), ...(legacy ? { legacy: true } : {}) }
}

export function recordDecision(discussion: Y.Map<unknown>, draft: DecisionDraft, original: DecisionBrief, by: string): string | null {
  if (discussion.get('status') !== 'open') return 'This discussion is no longer open. Reopen it before recording another decision.'
  const brief = readDecisionBrief(discussion.get('brief'))
  if (JSON.stringify(brief) !== JSON.stringify(readDecisionBrief(original))) return 'The brief changed while you were deciding. Cancel and review the latest brief before recording.'
  const option = brief.options.find((option) => option.id === draft.optionId && option.title)
  if (draft.optionId && !option) return 'Choose an option from the current brief, or choose another approach.'
  const choice = (option?.title ?? draft.choice).trim()
  if (!choice) return 'Describe the final choice.'
  if (choice.length > 1000) return 'Keep the final choice within 1,000 characters.'
  if (!draft.reasoning.trim()) return 'Explain why this choice won and which tradeoffs you accepted.'
  if (draft.reasoning.trim().length > 3000) return 'Keep the reasoning within 3,000 characters.'
  if (!by) return 'Sign in before recording this decision.'
  const recording: DecisionRecording = { id: crypto.randomUUID(), title: String(discussion.get('title') ?? '').slice(0, 200), choice, optionId: option?.id ?? '', reasoning: draft.reasoning.trim(), brief, by, at: Date.now() }
  const write = () => {
    let versions = discussion.get('recordings') as Y.Map<DecisionRecording> | undefined
    if (!(versions instanceof Y.Map)) { versions = new Y.Map(); discussion.set('recordings', versions) }
    versions.set(recording.id, recording)
    discussion.set('recording', recording)
    discussion.set('kind', 'question'); discussion.set('answer', choice); discussion.set('answeredBy', by); discussion.set('status', 'answered')
  }
  if (discussion.doc) discussion.doc.transact(write)
  else write()
  return null
}

// Write only fields changed in this draft. Independent edits merge through Yjs;
// a conflicting edit already received from a collaborator needs an explicit reload.
export function saveDecisionBrief(discussion: Y.Map<unknown>, draft: DecisionBrief, original: DecisionBrief): string | null {
  if (discussion.get('kind') !== 'question' || discussion.get('status') !== 'open') return 'This question is no longer open. Reopen it before editing the brief.'
  const invalid = validateDecisionBrief(draft)
  if (invalid) return invalid
  const next = readDecisionBrief(draft), base = readDecisionBrief(original), current = readDecisionBrief(discussion.get('brief'))
  const conflict = 'Someone changed the same part of this brief. Load the latest brief before saving.'
  const keys = ['context', 'recommendation', 'reasoning'] as const
  for (const key of keys) if (next[key] !== base[key] && current[key] !== base[key] && current[key] !== next[key]) return conflict
  const currentRows = new Map(current.options.map((option) => [option.id, option])), baseRows = new Map(base.options.map((option) => [option.id, option]))
  const nextRows = new Map(next.options.map((option) => [option.id, option]))
  const fields = ['title', 'benefits', 'tradeoffs'] as const
  for (const option of base.options) {
    const after = nextRows.get(option.id), latest = currentRows.get(option.id)
    if (!after && latest && fields.some((field) => latest[field] !== option[field])) return conflict
    if (after && !latest && fields.some((field) => after[field] !== option[field])) return conflict
    if (after && latest && fields.some((field) => after[field] !== option[field] && latest[field] !== option[field] && latest[field] !== after[field])) return conflict
  }
  const mergedIds = new Set([...currentRows.keys(), ...next.options.filter((option) => !baseRows.has(option.id)).map((option) => option.id)])
  for (const option of base.options) if (!nextRows.has(option.id)) mergedIds.delete(option.id)
  if (mergedIds.size > MAX_BRIEF_OPTIONS) return `This brief now has more than ${MAX_BRIEF_OPTIONS} options. Load the latest brief and combine a few choices.`
  const recommendation = next.recommendation !== base.recommendation ? next.recommendation : current.recommendation
  if (recommendation && !mergedIds.has(recommendation)) return 'The recommended option was removed. Load the latest brief and choose another.'

  const write = () => {
    let brief = discussion.get('brief') as Y.Map<unknown> | undefined
    if (!(brief instanceof Y.Map)) { brief = new Y.Map(); discussion.set('brief', brief) }
    let options = brief.get('options') as Y.Map<Y.Map<unknown>> | undefined
    if (!(options instanceof Y.Map)) { options = new Y.Map(); brief.set('options', options) }
    for (const key of keys) if (next[key] !== base[key]) brief.set(key, next[key])
    for (const option of base.options) if (!nextRows.has(option.id)) options.delete(option.id)
    next.options.forEach((option, position) => {
      const before = baseRows.get(option.id)
      if (before && !currentRows.has(option.id)) return // preserve a collaborator's deletion
      let row = options.get(option.id)
      if (!(row instanceof Y.Map)) { row = new Y.Map(); options.set(option.id, row); row.set('position', position) }
      for (const field of fields) if (!before || option[field] !== before[field]) row.set(field, option[field])
    })
  }
  if (discussion.doc) discussion.doc.transact(write)
  else write()
  return null
}
