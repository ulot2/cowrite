import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { emptyDecisionBrief, readDecisionBrief, readDecisionRecording, recordDecision, saveDecisionBrief } from '../app/lib/decision-brief.ts'

const seed = () => {
  const doc = new Y.Doc(), discussion = doc.getMap('question')
  discussion.set('title', 'What should we ship?'); discussion.set('kind', 'question'); discussion.set('status', 'open')
  saveDecisionBrief(discussion, { context: 'Ready in three days.', options: [
    { id: 'guide', title: 'Write a guide', benefits: 'Searchable', tradeoffs: 'Needs an owner' },
    { id: 'video', title: 'Make a video', benefits: 'Personal', tradeoffs: 'Slower to revise' },
  ], recommendation: 'guide', reasoning: 'A guide is quicker.' }, emptyDecisionBrief())
  return { doc, discussion, brief: readDecisionBrief(discussion.get('brief')) }
}

test('the final choice can differ from the recommendation and captures a durable brief', () => {
  const { doc, discussion, brief } = seed()
  assert.equal(recordDecision(discussion, { optionId: 'video', choice: '', reasoning: 'We accept slower editing for a warmer welcome.' }, brief, 'ada'), null)
  const saved = readDecisionRecording(discussion.get('recording'))
  assert.equal(saved.choice, 'Make a video'); assert.equal(saved.optionId, 'video')
  assert.equal(saved.brief.recommendation, 'guide'); assert.equal(discussion.get('status'), 'answered')
  discussion.get('brief').set('context', 'Later source edit')
  assert.equal(saved.brief.context, 'Ready in three days.')
  const restored = new Y.Doc(); Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc))
  assert.deepEqual(readDecisionRecording(restored.getMap('question').get('recording')), saved)
})

test('a custom outcome needs its own choice and rationale; no recommendation is silently accepted', () => {
  const { discussion, brief } = seed()
  assert.match(recordDecision(discussion, { optionId: '', choice: '', reasoning: 'Because.' }, brief, 'ada'), /final choice/)
  assert.match(recordDecision(discussion, { optionId: 'guide', choice: '', reasoning: '' }, brief, 'ada'), /tradeoffs/)
  assert.equal(discussion.get('status'), 'open'); assert.equal(discussion.get('recording'), undefined)
  assert.equal(recordDecision(discussion, { optionId: '', choice: 'Hold a welcome session', reasoning: 'The first group needs live answers.' }, brief, 'ada'), null)
  assert.equal(readDecisionRecording(discussion.get('recording')).optionId, '')
})

test('a changed brief requires review, and a resolved question cannot be recorded twice', () => {
  const { discussion, brief } = seed(), draft = { optionId: 'guide', choice: '', reasoning: 'Accept maintenance.' }
  discussion.get('brief').set('context', 'New constraint')
  assert.match(recordDecision(discussion, draft, brief, 'ada'), /brief changed/)
  assert.equal(recordDecision(discussion, draft, readDecisionBrief(discussion.get('brief')), 'ada'), null)
  const recording = discussion.get('recording')
  assert.match(recordDecision(discussion, draft, brief, 'ada'), /no longer open/)
  assert.equal(discussion.get('recording'), recording)
})

test('older discussions and malformed recordings are safe and bounded', () => {
  assert.equal(readDecisionRecording(undefined), null); assert.equal(readDecisionRecording('{'), null)
  const { discussion, brief } = seed()
  recordDecision(discussion, { optionId: 'guide', choice: '', reasoning: 'Accept maintenance.' }, brief, 'ada')
  const saved = discussion.get('recording')
  assert.equal(readDecisionRecording({ ...saved, optionId: 'gone' }), null)
  assert.equal(readDecisionRecording({ ...saved, at: Infinity }), null)
  assert.equal(readDecisionRecording({ ...saved, reasoning: '' }), null)
  assert.equal(readDecisionRecording({ ...saved, reasoning: 'x'.repeat(5000) }).reasoning.length, 3000)
})

test('rapid recording and reopening retains every version in the room', () => {
  const { doc, discussion, brief } = seed()
  assert.equal(recordDecision(discussion, { optionId: 'guide', choice: '', reasoning: 'Keep it simple.' }, brief, 'ada'), null)
  const first = discussion.get('recording')
  discussion.set('status', 'open')
  assert.equal(recordDecision(discussion, { optionId: 'video', choice: '', reasoning: 'We now have time for a personal welcome.' }, brief, 'bea'), null)
  const second = discussion.get('recording')
  discussion.set('status', 'open')
  assert.notEqual(first.id, second.id)
  assert.equal(discussion.get('recordings').size, 2)
  const restored = new Y.Doc(); Y.applyUpdate(restored, Y.encodeStateAsUpdate(doc))
  assert.equal(restored.getMap('question').get('recordings').size, 2)
})
