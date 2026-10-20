import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decisionPlanVersion, initialPlanDraft, readPlanDraft } from '../app/lib/decision-plan.ts'

const source = { decisionId: 'q:x', number: 4, text: 'How do we welcome people?', choice: 'Write a guide', reasoning: 'A guide stays useful.', version: 'v1' }

test('a plan draft carries the decision and reasoning, with no invented owners or dates', () => {
  const draft = initialPlanDraft(source)
  assert.equal(draft.goal, source.choice); assert.equal(draft.why, source.reasoning)
  assert.equal(new Set(draft.tasks.map((task) => task.id)).size, 3)
  assert.ok(draft.tasks.every((task) => !task.assignee && !task.due))
  assert.deepEqual(readPlanDraft(draft).draft, draft)
})

test('draft validation rejects missing work, duplicates, excessive content, and invalid calendar dates', () => {
  const draft = initialPlanDraft(source)
  for (const invalid of [null, { ...draft, title: '' }, { ...draft, goal: '' }, { ...draft, tasks: [] }, { ...draft, tasks: Array(13).fill(draft.tasks[0]) }, { ...draft, tasks: [draft.tasks[0], draft.tasks[0]] },
    { ...draft, tasks: [{ ...draft.tasks[0], text: 'x'.repeat(301) }] }, { ...draft, tasks: [{ ...draft.tasks[0], due: '2030-02-30' }] }, { ...draft, tasks: [{ ...draft.tasks[0], due: 'tomorrow' }] }]) assert.ok(readPlanDraft(invalid).error)
  assert.ok(readPlanDraft({ ...draft, tasks: [{ ...draft.tasks[0], due: '2032-02-29' }] }).draft)
})

test('source versions detect recording, status, outcome and replacement changes without incidental timestamps', () => {
  const decision = { recording_id: 'r1', text: source.text, outcome: source.choice, status: 'decided', decided_at: 1000, replaced_by: null }
  const version = decisionPlanVersion(decision)
  for (const patch of [{ recording_id: 'r2' }, { status: 'reopened' }, { outcome: 'Make a video' }, { replaced_by: 'd2' }]) assert.notEqual(decisionPlanVersion({ ...decision, ...patch }), version)
  assert.equal(decisionPlanVersion({ ...decision, updated_at: 99999 }), version)
})
