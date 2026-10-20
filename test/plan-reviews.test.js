import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { UNSAFE_decodeViaTurboStream } from 'react-router'
import { startApp, until } from './harness.js'
import { readDecisionBrief, recordDecision } from '../app/lib/decision-brief.ts'
import { decisionPlanVersion, initialPlanDraft } from '../app/lib/decision-plan.ts'

let app, ada, bea, viewer, outsider, space, room, peer, question, decision, planId, originalVersion
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const get = (path, user = ada) => fetch(app.base + path, { headers: { cookie: user.cookie }, redirect: 'manual' })
const decisionData = async (id, user = ada) => {
  const decoded = await UNSAFE_decodeViaTurboStream((await get(`/decision/${id}.data`, user)).body, globalThis)
  await decoded.done
  return Object.values(decoded.value).find((route) => route.data?.decision)?.data
}
const review = async (user = ada, id = decision.id, plan = planId) => {
  const response = await get(`/api/plan-review?${new URLSearchParams({ decision: id, plan })}`, user)
  return { status: response.status, ...await response.json() }
}
const confirm = (comparison, patch = {}, user = ada) => app.post('/api/plan-review', user.cookie, {
  decision: decision.id, plan: planId, target: comparison.current.decisionId, version: comparison.current.version,
  sequence: String(comparison.sequence), outcome: 'unchanged', checked: 'true', note: '', ...patch,
})
const revise = async (choice, reasoning, actor = ada) => {
  question.set('status', 'open')
  assert.equal(recordDecision(question, { optionId: '', choice, reasoning }, readDecisionBrief(question.get('brief')), actor.id), null)
  await sleep(3800)
}
before(async () => {
  app = await startApp()
  for (const name of ['Ada', 'Bea', 'Viewer', 'Outsider']) {
    const user = await app.signUpUser(name)
    user.id = (await (await get('/api/auth/get-session', user)).json()).user.id
    if (name === 'Ada') ada = user; else if (name === 'Bea') bea = user; else if (name === 'Viewer') viewer = user; else outsider = user
  }
  space = (await app.post('/?index', ada.cookie, { intent: 'new-space', name: 'Review affected plans' })).headers.get('location').split('/').pop()
  await app.post(`/space/${space}`, ada.cookie, { intent: 'add', email: bea.email, role: 'editor' })
  await app.post(`/space/${space}`, ada.cookie, { intent: 'add', email: viewer.email, role: 'viewer' })
  room = app.openTab(`space/${space}`, ada.cookie); peer = app.openTab(`space/${space}`, bea.cookie)
  await until(() => room.provider.synced && peer.provider.synced, 'review source synced')
  question = new Y.Map()
  room.doc.transact(() => {
    room.doc.getMap('discussions').set('review-source', question)
    for (const [key, value] of Object.entries({ title: 'How should we onboard?', kind: 'question', status: 'open', createdBy: ada.id, createdAt: Date.now() })) question.set(key, value)
    question.set('posts', new Y.Array())
    recordDecision(question, { optionId: '', choice: 'Publish a first-week guide', reasoning: 'A searchable guide is easy to maintain.' }, readDecisionBrief(question.get('brief')), ada.id)
  })
  await until(() => Number(question.get('decisionNumber')) > 0, 'review decision numbered')
  decision = (await decisionData('q:review-source')).decision
  originalVersion = decisionPlanVersion(decision)
  const response = await app.post(`/decision/${decision.id}`, ada.cookie, { intent: 'create-plan', request: crypto.randomUUID(), version: originalVersion,
    draft: JSON.stringify(initialPlanDraft({ text: decision.text, choice: decision.outcome, reasoning: 'A searchable guide is easy to maintain.' })) })
  assert.equal(response.status, 302, await response.clone().text())
  planId = response.headers.get('location').split('/').pop()
})
after(() => { room?.close(); peer?.close(); app?.stop() })

test('opening and cancelling a review has no side effects; current plans show their original basis', async () => {
  const a = (await review()).review, b = (await review()).review
  assert.equal(a.sequence, 0); assert.equal(b.history.length, 0); assert.equal(a.currentReviewed, true)
  assert.equal(a.baseline.choice, 'Publish a first-week guide'); assert.equal(a.baseline.reasoning, 'A searchable guide is easy to maintain.')
  assert.equal((await review(viewer)).review.canConfirm, false)
  assert.equal((await review(outsider)).status, 404)
  assert.equal((await review(ada, decision.id, crypto.randomUUID())).status, 404)
})

test('a revised decision shows immutable previous choice and reasoning without editing tasks', async () => {
  await revise('Pair the guide with a live welcome', 'New starters need room for questions.')
  const comparison = (await review()).review
  assert.equal(comparison.currentReviewed, false); assert.equal(comparison.sequence, 0)
  assert.equal(comparison.baseline.version, originalVersion)
  assert.equal(comparison.baseline.choice, 'Publish a first-week guide')
  assert.equal(comparison.current.choice, 'Pair the guide with a live welcome')
  assert.equal(comparison.current.reasoning, 'New starters need room for questions.')
  const markdown = await (await get(`/doc/${planId}/export?format=md`)).text()
  assert.match(markdown, /Publish a first-week guide/); assert.doesNotMatch(markdown, /Pair the guide/)
  assert.match(await (await get(`/decision/${decision.id}`)).text(), /needs review/)
})

test('permissions, explicit acknowledgement, valid outcome and update note are required', async () => {
  const comparison = (await review()).review
  assert.equal((await confirm(comparison, {}, viewer)).status, 403)
  assert.equal((await confirm(comparison, {}, outsider)).status, 404)
  for (const patch of [{ checked: 'false' }, { outcome: 'auto' }, { outcome: 'updated', note: '' }, { note: 'x'.repeat(2001) }, { version: originalVersion }]) {
    assert.ok((await (await confirm(comparison, patch)).json()).error)
  }
  assert.equal((await review()).review.history.length, 0)
})

test('simultaneous confirmations save one reviewer and version and preserve the plan', async () => {
  const comparison = (await review()).review
  const before = await (await get(`/doc/${planId}/export?format=md`)).text()
  const replies = await Promise.all([confirm(comparison, { note: 'The guide work still supports the live welcome.' }, bea), confirm(comparison)])
  const results = await Promise.all(replies.map((response) => response.json()))
  assert.ok(results.every((result) => result.review?.currentReviewed), JSON.stringify(results))
  assert.equal(results.filter((result) => result.saved).length, 1)
  const saved = (await review()).review
  assert.equal(saved.history.length, 1); assert.equal(saved.history[0].source.version, comparison.current.version)
  assert.ok(['Ada', 'Bea'].includes(saved.history[0].by)); assert.equal(saved.history[0].outcome, 'unchanged')
  assert.equal((await (await confirm(comparison)).json()).saved, false)
  assert.equal(await (await get(`/doc/${planId}/export?format=md`)).text(), before)
  const row = (await decisionData(decision.id)).plans[0]
  assert.equal(row.version, originalVersion, 'original provenance stays intact')
  assert.equal(row.reviewedVersion, comparison.current.version)
})

test('later changes compare with the last review, retain history, and record a reviewed update', async () => {
  const previous = (await review()).review
  await revise('Run a weekly live welcome', 'Regular sessions help late joiners too.')
  const comparison = (await review()).review
  assert.equal(comparison.currentReviewed, false)
  assert.equal(comparison.baseline.version, previous.current.version)
  const stale = await (await confirm(previous)).json()
  assert.match(stale.error, /decision changed/)
  const saved = await (await confirm(comparison, { outcome: 'updated', note: 'Added a weekly welcome task in the plan.' }, bea)).json()
  assert.equal(saved.saved, true); assert.equal(saved.review.history.length, 2)
  assert.equal(saved.review.history[0].outcome, 'updated'); assert.equal(saved.review.history[0].by, 'Bea')
  assert.equal(saved.review.history[0].note, 'Added a weekly welcome task in the plan.')
  assert.equal(saved.review.history[1].source.version, previous.current.version)
})

test('live reopening blocks confirmation before indexing and indexed reopening keeps the review unresolved', async () => {
  await revise('Offer a recorded welcome too', 'People in other time zones need an alternative.')
  const comparison = (await review()).review
  question.set('status', 'open')
  await until(() => peer.doc.getMap('discussions').get('review-source')?.get('status') === 'open', 'reopen received by server')
  assert.match((await (await confirm(comparison)).json()).error, /source decision just changed/)
  await sleep(3800)
  const open = (await review()).review
  assert.ok(open.blocked); assert.equal(open.currentReviewed, false)
  assert.match((await (await confirm(open)).json()).error, /open or dropped/)
  assert.equal(open.history.length, 2)
  await revise('Offer a recorded welcome too', 'People in other time zones need an alternative.')
})

test('a replacement decision can be reviewed without changing original plan provenance', async () => {
  const replacement = new Y.Map()
  room.doc.transact(() => {
    room.doc.getMap('discussions').set('replacement', replacement)
    for (const [key, value] of Object.entries({ title: 'A better welcome', kind: 'question', status: 'open', createdBy: ada.id, createdAt: Date.now() })) replacement.set(key, value)
    replacement.set('posts', new Y.Array())
    recordDecision(replacement, { optionId: '', choice: 'Use a buddy for each new starter', reasoning: 'Personal support handles varied needs.' }, readDecisionBrief(replacement.get('brief')), ada.id)
  })
  await until(() => Number(replacement.get('decisionNumber')) > 0, 'replacement numbered')
  assert.equal((await app.post('/decision/q:replacement', ada.cookie, { intent: 'supersede', older: decision.id })).status, 200)
  const comparison = (await review()).review
  assert.equal(comparison.current.decisionId, 'q:replacement')
  assert.equal(comparison.current.choice, 'Use a buddy for each new starter')
  assert.equal((await decisionData('q:replacement')).plans[0].id, planId, 'replacement surfaces affected plans from the original decision')
  const saved = await (await confirm(comparison, { outcome: 'updated', note: 'Adjusted the plan to support buddy onboarding.' })).json()
  assert.equal(saved.saved, true); assert.equal(saved.review.currentReviewed, true)
  const row = (await decisionData(decision.id)).plans[0]
  assert.equal(row.version, originalVersion); assert.equal(row.reviewedDecisionId, 'q:replacement')
})

test('returning to a previously reviewed replacement allows a fresh review and retains each acknowledgement', async () => {
  const previous = (await review()).review, replacement = new Y.Map()
  room.doc.transact(() => {
    room.doc.getMap('discussions').set('temporary-replacement', replacement)
    for (const [key, value] of Object.entries({ title: 'Try a different onboarding format', kind: 'question', status: 'open', createdBy: ada.id, createdAt: Date.now() })) replacement.set(key, value)
    replacement.set('posts', new Y.Array())
    recordDecision(replacement, { optionId: '', choice: 'Use small group sessions', reasoning: 'Groups may scale better.' }, readDecisionBrief(replacement.get('brief')), ada.id)
  })
  await until(() => Number(replacement.get('decisionNumber')) > 0, 'temporary replacement numbered')
  await app.post('/decision/q:temporary-replacement', ada.cookie, { intent: 'supersede', older: 'q:replacement' })
  assert.equal((await (await confirm((await review()).review)).json()).saved, true)
  await app.post('/decision/q:temporary-replacement', ada.cookie, { intent: 'supersede', older: '' })
  const returned = (await review()).review
  assert.equal(returned.current.version, previous.current.version)
  assert.equal(returned.currentReviewed, false)
  const confirmed = await (await confirm(returned)).json()
  assert.equal(confirmed.saved, true); assert.equal(confirmed.review.history.length, previous.history.length + 2)
  assert.equal(confirmed.review.currentReviewed, true)
})

test('removing plan access hides reviews even when the source decision remains visible', async () => {
  await app.post(`/doc/${planId}`, ada.cookie, { intent: 'move', space_id: '' })
  // Space memberships do not grant access after a plan leaves the space.
  assert.equal((await review(viewer)).status, 404)
  assert.equal((await review(bea)).status, 404)
  assert.equal((await decisionData(decision.id, viewer)).plans.length, 0)
})

test('confirmation requires editing both the plan and the decision, including after access changes', async () => {
  await app.post(`/doc/${planId}`, ada.cookie, { intent: 'add', email: bea.email, role: 'viewer' })
  await app.post(`/doc/${planId}`, ada.cookie, { intent: 'add', email: viewer.email, role: 'editor' })
  await app.post(`/doc/${planId}`, ada.cookie, { intent: 'add', email: outsider.email, role: 'editor' })
  for (const user of [bea, viewer]) {
    const comparison = (await review(user)).review
    assert.equal(comparison.canConfirm, false)
    assert.equal((await confirm(comparison, {}, user)).status, 403)
  }
  assert.equal((await review(outsider)).status, 404, 'direct plan access does not grant source decision access')
})
