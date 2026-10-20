import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { UNSAFE_decodeViaTurboStream } from 'react-router'
import { startApp, until } from './harness.js'
import { readDecisionBrief, recordDecision } from '../app/lib/decision-brief.ts'
import { decisionPlanVersion, initialPlanDraft } from '../app/lib/decision-plan.ts'

let app, ada, bea, viewer, outsider, space, unrelatedSpace, room, question, decision, plans
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const get = (path, user = ada) => fetch(app.base + path, { headers: { cookie: user.cookie }, redirect: 'manual' })
const data = async (path, key, user = ada) => {
  const decoded = await UNSAFE_decodeViaTurboStream((await get(path, user)).body, globalThis)
  await decoded.done
  return Object.values(decoded.value).find((route) => route.data && key in route.data)?.data
}
const home = (user = ada) => data('/.data', 'waiting', user)
const overview = (user = ada, id = space) => data(`/space/${id}.data`, 'planReviews', user)
const queue = async (user = ada) => (await home(user)).waiting.filter((row) => row.actionLabel === 'Review plan')
const revise = async (choice = 'Pair the guide with a live welcome') => {
  question.set('status', 'open')
  assert.equal(recordDecision(question, { optionId: '', choice, reasoning: 'New starters need a place to ask questions.' }, readDecisionBrief(question.get('brief')), ada.id), null)
  await sleep(3800)
}
const confirm = async (plan) => {
  const comparison = (await (await get(`/api/plan-review?${new URLSearchParams({ decision: decision.id, plan })}`)).json()).review
  const response = await app.post('/api/plan-review', ada.cookie, {
    decision: decision.id, plan, target: comparison.current.decisionId, version: comparison.current.version,
    sequence: String(comparison.sequence), outcome: 'unchanged', checked: 'true', note: 'The current work still supports this decision.',
  })
  const result = await response.json()
  assert.equal(result.review?.currentReviewed, true, JSON.stringify(result))
  return result
}
before(async () => {
  app = await startApp()
  ;[ada, bea, viewer, outsider] = await Promise.all(['Ada', 'Bea', 'Viewer', 'Outsider'].map((name) => app.signUpUser(name)))
  for (const user of [ada, bea, viewer, outsider]) user.id = (await (await get('/api/auth/get-session', user)).json()).user.id
  space = (await app.post('/?index', ada.cookie, { intent: 'new-space', name: 'Plan attention' })).headers.get('location').split('/').pop()
  unrelatedSpace = (await app.post('/?index', ada.cookie, { intent: 'new-space', name: 'Other work' })).headers.get('location').split('/').pop()
  for (const [person, role] of [[bea, 'editor'], [viewer, 'viewer']]) await app.post(`/space/${space}`, ada.cookie, { intent: 'add', email: person.email, role })
  room = app.openTab(`space/${space}`, ada.cookie)
  await until(() => room.provider.synced, 'attention source synced')
  question = new Y.Map()
  room.doc.transact(() => {
    room.doc.getMap('discussions').set('attention-source', question)
    for (const [key, value] of Object.entries({ title: 'How should we welcome new teammates?', kind: 'question', status: 'open', createdBy: ada.id, createdAt: Date.now() })) question.set(key, value)
    question.set('posts', new Y.Array())
    recordDecision(question, { optionId: '', choice: 'Publish a first-week guide', reasoning: 'A searchable reference helps people find their way.' }, readDecisionBrief(question.get('brief')), ada.id)
    room.doc.getMap('tasks').set('other-person-task', { text: 'Send the old onboarding notes', assignee: viewer.id, assigneeName: 'Viewer', due: '2020-01-01', done: false, discussionId: 'attention-source', postId: 'opening', createdBy: ada.id })
  })
  await until(() => Number(question.get('decisionNumber')) > 0, 'attention decision numbered')
  decision = (await data('/decision/q:attention-source.data', 'decision')).decision
  plans = []
  for (const title of ['Write the first-week guide', 'Prepare the onboarding handoff']) {
    const draft = initialPlanDraft({ text: decision.text, choice: decision.outcome, reasoning: 'Make a useful starting point.' }); draft.title = title
    const created = await app.post(`/decision/${decision.id}`, ada.cookie, { intent: 'create-plan', request: crypto.randomUUID(), version: decisionPlanVersion(decision), draft: JSON.stringify(draft) })
    assert.equal(created.status, 302, await created.clone().text())
    plans.push(created.headers.get('location').split('/').pop())
  }
})
after(() => { room?.close(); app?.stop() })

test('current plans create no review rows and queues stay scoped to the relevant space', async () => {
  assert.deepEqual(await queue(), [])
  assert.deepEqual((await overview()).planReviews, [])
  assert.deepEqual((await overview(ada, unrelatedSpace)).planReviews, [])
})

test('a changed decision contributes one personal review per plan with a direct comparison link', async () => {
  await revise()
  const rows = await queue(bea), team = (await overview(bea)).planReviews
  assert.equal(rows.length, 2); assert.equal(new Set(rows.map((row) => row.key)).size, 2)
  assert.equal(team.length, 2)
  for (const row of rows) {
    assert.equal(row.verb, 'Review'); assert.equal(row.whoId, bea.id)
    assert.match(row.detail, /D-1: How should we welcome new teammates\? · Decision changed/)
    assert.equal(row.note, 'Plan attention')
    const link = new URL(row.to, app.base)
    assert.equal(decodeURIComponent(link.pathname), `/decision/${decision.id}`)
    assert.ok(plans.includes(link.searchParams.get('review')))
    assert.equal(link.hash, `#plan-review-${link.searchParams.get('review')}`)
  }
  assert.equal((await overview(ada, unrelatedSpace)).planReviews.length, 0)
})

test('viewers can read team review requests but get no personal review count or false assignment', async () => {
  assert.deepEqual(await queue(viewer), [])
  const team = (await overview(viewer)).planReviews
  assert.equal(team.length, 2); assert.ok(team.every((row) => !row.canConfirm))
  const html = await (await get(`/space/${space}`, viewer)).text()
  assert.match(html, /Editor review needed/)
  const editorHtml = await (await get(`/space/${space}`, bea)).text()
  const titles = [...editorHtml.matchAll(/class="attention-title">([^<]+)/g)].map((match) => match[1])
  assert.ok(titles.indexOf('Write the first-week guide') < titles.indexOf('Send the old onboarding notes'), 'work this editor can act on comes first')
})

test('deep links render only the selected accessible comparison and unavailable targets recover safely', async () => {
  const target = (await queue())[0]
  const html = await (await get(target.to)).text()
  assert.match(html, new RegExp(`id="plan-review-${new URL(target.to, app.base).searchParams.get('review')}"`))
  assert.equal((html.match(/class="plan-review-panel"/g) || []).length, 1)
  assert.match(html, /Loading the decision comparison/)
  const unavailable = await (await get(`/decision/${decision.id}?review=${crypto.randomUUID()}`)).text()
  assert.match(unavailable, /This plan is no longer available here/)
  assert.equal((await get(target.to, outsider)).status, 404)
})

test('confirmation clears only that plan from Home and the overview while keeping its review history', async () => {
  await confirm(plans[0])
  assert.equal((await queue()).length, 1)
  assert.equal((await overview()).planReviews.length, 1)
  const saved = (await (await get(`/api/plan-review?${new URLSearchParams({ decision: decision.id, plan: plans[0] })}`)).json()).review
  assert.equal(saved.history.length, 1)
  assert.equal(saved.history[0].by, 'Ada')
  assert.equal((await confirm(plans[0])).saved, false)
  assert.equal((await queue()).length, 1)
})

test('reopened decisions stay visible as waiting team work until a new decision permits review', async () => {
  question.set('status', 'open'); await sleep(3800)
  assert.equal((await queue()).length, 0)
  const team = (await overview()).planReviews
  assert.equal(team.length, 2); assert.ok(team.every((row) => row.waitingForDecision && !row.canConfirm))
  assert.match(await (await get(`/space/${space}`)).text(), /Waiting for decision/)
  await revise('Make the guide available before the live welcome')
  assert.equal((await queue()).length, 2)
})

test('replacement decisions produce one review per plan and link to the current decision', async () => {
  const replacement = new Y.Map()
  room.doc.transact(() => {
    room.doc.getMap('discussions').set('attention-replacement', replacement)
    for (const [key, value] of Object.entries({ title: 'Who supports each new starter?', kind: 'question', status: 'open', createdBy: ada.id, createdAt: Date.now() })) replacement.set(key, value)
    replacement.set('posts', new Y.Array())
    recordDecision(replacement, { optionId: '', choice: 'Assign a buddy alongside the guide', reasoning: 'A named person handles individual questions.' }, readDecisionBrief(replacement.get('brief')), ada.id)
  })
  await until(() => Number(replacement.get('decisionNumber')) > 0, 'attention replacement numbered')
  await app.post('/decision/q:attention-replacement', ada.cookie, { intent: 'supersede', older: decision.id })
  const rows = await queue()
  assert.equal(rows.length, 2)
  assert.ok(rows.every((row) => decodeURIComponent(new URL(row.to, app.base).pathname) === '/decision/q:attention-replacement'))
  assert.ok(rows.every((row) => row.detail.includes('D-2: Who supports each new starter?')))
  assert.equal((await overview()).planReviews.length, 2)
  const html = await (await get(rows[0].to)).text()
  assert.match(html, /class="plan-review-panel"/)
  await confirm(plans[1]); assert.equal((await queue()).length, 1)
})

test('plan and source permission changes immediately remove inaccessible review requests', async () => {
  await app.post(`/doc/${plans[0]}`, ada.cookie, { intent: 'move', space_id: '' })
  assert.equal((await queue(bea)).length, 0, 'space-only access no longer reaches the pending plan')
  assert.equal((await overview(bea)).planReviews.length, 0)
  assert.equal((await queue()).length, 1, 'the owner retains both source and plan access')
  await app.post(`/doc/${plans[0]}`, ada.cookie, { intent: 'add', email: outsider.email, role: 'editor' })
  assert.equal((await queue(outsider)).length, 0, 'a direct plan editor cannot see the private source decision')
  await app.post(`/doc/${plans[0]}`, ada.cookie, { intent: 'add', email: bea.email, role: 'viewer' })
  assert.equal((await queue(bea)).length, 0, 'a source editor with a read-only plan cannot confirm')
  assert.equal((await overview(bea)).planReviews.length, 1, 'readable team work remains visible')
  await app.post(`/doc/${plans[0]}`, ada.cookie, { intent: 'role', user_id: bea.id, role: 'editor' })
  assert.equal((await queue(bea)).length, 1)
  await app.post(`/space/${space}`, ada.cookie, { intent: 'remove', user_id: bea.id })
  assert.equal((await queue(bea)).length, 0, 'removing source membership does not leak through a direct plan grant')
})

test('confirming the remaining review clears the queue without resetting stored history', async () => {
  await confirm(plans[0])
  assert.equal((await queue()).length, 0); assert.equal((await overview()).planReviews.length, 0)
  const saved = (await (await get(`/api/plan-review?${new URLSearchParams({ decision: decision.id, plan: plans[0] })}`)).json()).review
  assert.equal(saved.history.length, 2)
})
