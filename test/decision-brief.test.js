import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { emptyDecisionBrief, readDecisionBrief, saveDecisionBrief, validateDecisionBrief, decisionBriefText } from '../app/lib/decision-brief.ts'

const seed = () => {
  const doc = new Y.Doc(), discussion = doc.getMap('discussion')
  discussion.set('kind', 'question'); discussion.set('status', 'open')
  const brief = { context: 'A clear first week.', options: [{ id: 'guide', title: 'Write a guide', benefits: 'Easy to update', tradeoffs: 'Needs reading' }, { id: 'video', title: 'Make a video', benefits: 'A personal welcome', tradeoffs: 'Slower to revise' }], recommendation: 'guide', reasoning: 'Start with something we can keep current.' }
  assert.equal(saveDecisionBrief(discussion, brief, emptyDecisionBrief()), null)
  return { doc, discussion, brief: readDecisionBrief(discussion.get('brief')) }
}

test('old or malformed brief data is safe, bounded, and has no dangling recommendation', () => {
  assert.deepEqual(readDecisionBrief(undefined), emptyDecisionBrief())
  assert.deepEqual(readDecisionBrief({ options: [null, false, { id: 'x', title: '<script>plain text</script>' }, { id: 'x', title: 'Duplicate' }], recommendation: 'gone', context: 'a'.repeat(4000) }), {
    context: 'a'.repeat(3000), options: [{ id: 'x', title: '<script>plain text</script>', benefits: '', tradeoffs: '' }], recommendation: '', reasoning: '',
  })
})

test('incomplete option names and recommendations cannot be saved', () => {
  const { discussion, brief } = seed()
  const invalid = { ...brief, options: [{ id: 'x', title: '', benefits: 'An unnamed approach', tradeoffs: '' }] }
  assert.match(validateDecisionBrief(invalid), /name/)
  assert.match(saveDecisionBrief(discussion, { ...brief, reasoning: '' }, brief), /why/)
  assert.deepEqual(readDecisionBrief(discussion.get('brief')), brief)
})

test('a brief survives encoding and includes its choices and recommendation in search context', () => {
  const { doc, brief } = seed(), restored = new Y.Doc()
  Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc))
  assert.deepEqual(readDecisionBrief(restored.getMap('discussion').get('brief')), brief)
  const text = decisionBriefText(brief)
  for (const words of ['Context: A clear first week.', 'Option: Write a guide', 'Tradeoffs: Slower to revise', 'Recommendation: Write a guide', 'Why: Start with something']) assert.ok(text.includes(words))
})

test('simultaneous independent edits merge without losing another collaborator’s changes', () => {
  const { doc: a, discussion: first, brief: base } = seed(), b = new Y.Doc()
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  const second = b.getMap('discussion')
  assert.equal(saveDecisionBrief(first, { ...base, context: 'The team starts on Monday.' }, base), null)
  assert.equal(saveDecisionBrief(second, { ...base, options: base.options.map((option) => option.id === 'guide' ? { ...option, benefits: 'Searchable and easy to update' } : option) }, base), null)
  const au = Y.encodeStateAsUpdate(a), bu = Y.encodeStateAsUpdate(b)
  Y.applyUpdate(a, bu); Y.applyUpdate(b, au)
  const merged = readDecisionBrief(first.get('brief'))
  assert.equal(merged.context, 'The team starts on Monday.')
  assert.equal(merged.options[0].benefits, 'Searchable and easy to update')
  assert.deepEqual(readDecisionBrief(second.get('brief')), merged)
})

test('a received edit to the same field is not silently overwritten', () => {
  const { discussion, brief: base } = seed()
  assert.equal(saveDecisionBrief(discussion, { ...base, context: 'A collaborator changed this.' }, base), null)
  assert.match(saveDecisionBrief(discussion, { ...base, context: 'My stale draft.' }, base), /Someone changed/)
  assert.equal(readDecisionBrief(discussion.get('brief')).context, 'A collaborator changed this.')
})

test('removing an option cannot discard a received edit to its tradeoffs', () => {
  const { discussion, brief: base } = seed()
  assert.equal(saveDecisionBrief(discussion, { ...base, options: base.options.map((option) => option.id === 'video' ? { ...option, tradeoffs: 'Recording needs three days.' } : option) }, base), null)
  assert.match(saveDecisionBrief(discussion, { ...base, options: base.options.filter((option) => option.id !== 'video') }, base), /Someone changed/)
  assert.equal(readDecisionBrief(discussion.get('brief')).options.length, 2)
})

test('deleting the recommended option also clears the recommendation', () => {
  const { discussion, brief } = seed()
  assert.equal(saveDecisionBrief(discussion, { ...brief, options: brief.options.filter((option) => option.id !== 'guide'), recommendation: '', reasoning: '' }, brief), null)
  const after = readDecisionBrief(discussion.get('brief'))
  assert.equal(after.recommendation, ''); assert.equal(after.reasoning, ''); assert.equal(after.options.length, 1)
})

test('answered, closed, and ordinary discussions refuse brief changes', () => {
  const { discussion, brief } = seed()
  for (const status of ['answered', 'closed']) {
    discussion.set('status', status)
    assert.match(saveDecisionBrief(discussion, { ...brief, context: 'Changed' }, brief), /no longer open/)
  }
  discussion.set('status', 'open'); discussion.set('kind', 'talk')
  assert.match(saveDecisionBrief(discussion, { ...brief, context: 'Changed' }, brief), /no longer open/)
})
