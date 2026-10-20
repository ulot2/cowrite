import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { UNSAFE_decodeViaTurboStream } from 'react-router'
import { startApp, until } from './harness.js'
import { emptyDecisionBrief, readDecisionBrief, recordDecision, saveDecisionBrief } from '../app/lib/decision-brief.ts'
import { decisionPlanVersion, initialPlanDraft } from '../app/lib/decision-plan.ts'

let app, ada, bea, viewer, outsider, space, room, question, decision, fields, planId, planTab
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const idOf = async (user) => (await (await fetch(`${app.base}/api/auth/get-session`, { headers: { cookie: user.cookie } })).json()).user.id
const get = (path, user = ada) => fetch(app.base + path, { headers: { cookie: user.cookie }, redirect: 'manual' })
const data = async (id, user = ada) => {
  const decoded = await UNSAFE_decodeViaTurboStream((await get(`/decision/${id}.data`, user)).body, globalThis)
  await decoded.done
  return Object.values(decoded.value).find((route) => route.data?.decision)?.data
}
const documentData = async (id, user = ada) => {
  const decoded = await UNSAFE_decodeViaTurboStream((await get(`/doc/${id}.data`, user)).body, globalThis)
  await decoded.done
  return Object.values(decoded.value).find((route) => route.data?.document)?.data
}
const graph = async (kind, id, user = ada) => (await get(`/api/connections?${new URLSearchParams({ kind, id })}`, user)).json()
const taskNodes = (doc) => {
  const result = []
  const walk = (node) => { if (!(node instanceof Y.XmlElement)) return; if (node.nodeName === 'task') result.push(node); else node.forEach(walk) }
  doc.getXmlFragment('document-store').forEach(walk); return result
}
before(async () => {
  app = await startApp(); ada = await app.signUpUser('Ada'); bea = await app.signUpUser('Bea'); viewer = await app.signUpUser('Viewer'); outsider = await app.signUpUser('Outsider')
  for (const user of [ada, bea, viewer, outsider]) user.id = await idOf(user)
  space = (await app.post('/?index', ada.cookie, { intent: 'new-space', name: 'Decision plans' })).headers.get('location').split('/').pop()
  await app.post(`/space/${space}`, ada.cookie, { intent: 'add', email: bea.email, role: 'editor' })
  await app.post(`/space/${space}`, ada.cookie, { intent: 'add', email: viewer.email, role: 'viewer' })
  room = app.openTab(`space/${space}`, ada.cookie); await until(() => room.provider.synced, 'plan source room synced')
  question = new Y.Map()
  room.doc.transact(() => {
    room.doc.getMap('discussions').set('plan-source', question)
    for (const [key, value] of Object.entries({ title: 'How should we onboard?', kind: 'question', status: 'open', createdBy: ada.id, createdAt: Date.now() })) question.set(key, value)
    question.set('posts', new Y.Array())
    saveDecisionBrief(question, { ...emptyDecisionBrief(), context: 'New teammates arrive next week.' }, emptyDecisionBrief())
    recordDecision(question, { optionId: '', choice: 'Publish a first-week guide', reasoning: 'A searchable reference is easier to maintain.' }, readDecisionBrief(question.get('brief')), ada.id)
  })
  await until(() => Number(question.get('decisionNumber')) > 0, 'plan source numbered')
  decision = (await data('q:plan-source')).decision
  const draft = initialPlanDraft({ text: decision.text, choice: decision.outcome, reasoning: question.get('recording').reasoning })
  draft.title = 'First-week guide delivery'; draft.tasks = [
    { id: crypto.randomUUID(), text: 'Draft the welcome guide', assignee: bea.id, due: '2030-10-23' },
    { id: crypto.randomUUID(), text: 'Review the guide with a new teammate', assignee: '', due: '' },
  ]
  fields = { intent: 'create-plan', request: crypto.randomUUID(), version: decisionPlanVersion(decision), draft: JSON.stringify(draft) }
})
after(() => { room?.close(); planTab?.close(); app?.stop() })

test('opening a decision has no draft side effects; only editors can confirm', async () => {
  const before = await graph('decision', decision.id)
  assert.ok(!before.items.some((item) => item.kind === 'document'))
  assert.doesNotMatch(await (await get('/tasks', bea)).text(), /Draft the welcome guide/)
  assert.equal((await app.post(`/decision/${decision.id}`, viewer.cookie, fields)).status, 403)
  assert.equal((await app.post(`/decision/${decision.id}`, outsider.cookie, fields)).status, 404)
  const html = await (await get(`/decision/${decision.id}`, viewer)).text()
  assert.doesNotMatch(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''), /Create plan/)
})

test('invalid tasks, foreign owners and stale decisions keep the draft uncreated', async () => {
  const draft = JSON.parse(fields.draft)
  for (const [patch, expected] of [
    [{ version: 'old' }, /decision changed/],
    [{ draft: JSON.stringify({ ...draft, tasks: [] }) }, /between 1 and 12/],
    [{ draft: JSON.stringify({ ...draft, tasks: [{ ...draft.tasks[0], assignee: outsider.id }] }) }, /no longer a member/],
    [{ draft: JSON.stringify({ ...draft, tasks: [{ ...draft.tasks[0], due: '2030-02-30' }] }) }, /valid due date/],
  ]) {
    const response = await app.post(`/decision/${decision.id}`, ada.cookie, { ...fields, ...patch })
    assert.equal(response.status, 200); assert.match(await response.text(), expected)
  }
  assert.ok(!(await graph('decision', decision.id)).items.some((item) => item.kind === 'document'))
})

test('confirmation creates editable task blocks and reciprocal implementation links', async () => {
  const [response, duplicate] = await Promise.all([app.post(`/decision/${decision.id}`, ada.cookie, fields), app.post(`/decision/${decision.id}`, ada.cookie, fields)])
  assert.equal(response.status, 302, await response.clone().text())
  assert.equal(duplicate.headers.get('location'), response.headers.get('location'), 'simultaneous confirmations share one plan')
  planId = response.headers.get('location').split('/').pop()
  planTab = app.openTab(planId, ada.cookie); await until(() => planTab.provider.synced, 'new plan synced')
  const nodes = taskNodes(planTab.doc)
  assert.equal(nodes.length, 2); assert.equal(nodes[0].getAttribute('assignee'), bea.id); assert.equal(nodes[0].getAttribute('due'), '2030-10-23')
  const markdown = await (await get(`/doc/${planId}/export?format=md`, bea)).text()
  for (const text of ['First-week guide delivery', 'Publish a first-week guide', 'A searchable reference is easier to maintain.', '/decision/q:plan-source', 'Draft the welcome guide']) assert.ok(markdown.includes(text), text)
  const linked = await graph('decision', decision.id)
  assert.equal(linked.items.find((item) => item.kind === 'document' && item.id === planId)?.reason, 'Implemented by')
  for (const node of nodes) assert.equal(linked.items.find((item) => item.kind === 'task' && item.id === node.getAttribute('taskId'))?.reason, 'Implemented by')
  assert.equal((await graph('document', planId)).items.find((item) => item.kind === 'decision')?.reason, 'Implements')
  assert.equal((await get(`/doc/${planId}`, viewer)).status, 200); assert.equal((await get(`/doc/${planId}`, outsider)).status, 404)
})

test('retried confirmations create one document and one copy of every task', async () => {
  const replies = await Promise.all([app.post(`/decision/${decision.id}`, ada.cookie, fields), app.post(`/decision/${decision.id}`, ada.cookie, fields)])
  for (const reply of replies) assert.equal(reply.headers.get('location'), `/doc/${planId}`)
  assert.equal((await data(decision.id)).plans.length, 1)
  assert.equal(taskNodes(planTab.doc).length, 2)
  const inbox = await (await get('/api/inbox', bea)).json()
  assert.equal(inbox.events.filter((event) => event.type === 'task' && event.text.includes('Draft the welcome guide')).length, 1, 'one assignment event')
})

test('progress follows real task completion and later tasks in the plan', async () => {
  const node = taskNodes(planTab.doc)[0], id = node.getAttribute('taskId')
  assert.match(await (await get('/tasks', bea)).text(), /Draft the welcome guide/)
  assert.equal((await app.post('/tasks', bea.cookie, { id, done: 'true' })).status, 200)
  await until(() => String(node.getAttribute('done')) === 'true', 'the plan task ticks live')
  let plans = (await data(decision.id, viewer)).plans
  assert.equal(plans[0].done, 1); assert.equal(plans[0].total, 2)
  const extra = new Y.XmlElement('task'); extra.setAttribute('taskId', crypto.randomUUID()); extra.setAttribute('done', false); extra.insert(0, [new Y.XmlText('Keep the guide current')])
  planTab.doc.getXmlFragment('document-store').push([extra]); await sleep(3800)
  plans = (await data(decision.id)).plans
  assert.equal(plans[0].total, 3); assert.equal(plans[0].done, 1)
})

test('reopening or revising the source preserves the plan and marks it for review', async (t) => {
  const peer = app.openTab(`space/${space}`, bea.cookie); t.after(() => peer.close())
  await until(() => peer.provider.synced, 'live source peer synced')
  question.set('status', 'open')
  await until(() => peer.doc.getMap('discussions').get('plan-source')?.get('status') === 'open', 'server received reopened source')
  const immediate = await app.post(`/decision/${decision.id}`, ada.cookie, { ...fields, request: crypto.randomUUID() })
  assert.match(await immediate.text(), /source decision just changed|decided, current decision/, 'live source protects the indexing window')
  await sleep(3800)
  const blocked = await app.post(`/decision/${decision.id}`, ada.cookie, { ...fields, request: crypto.randomUUID() })
  assert.match(await blocked.text(), /decided, current decision/)
  assert.equal(recordDecision(question, { optionId: '', choice: 'Hold a live welcome', reasoning: 'The group needs live answers.' }, readDecisionBrief(question.get('brief')), ada.id), null)
  await sleep(3800)
  const latest = await data(decision.id)
  assert.notEqual(latest.plans[0].version, decisionPlanVersion(latest.decision))
  assert.match(await (await get(`/decision/${decision.id}`)).text(), /From an earlier version/)
  assert.match(await (await get(`/doc/${planId}/export?format=txt`)).text(), /Publish a first-week guide/)
  const stale = await app.post(`/decision/${decision.id}`, ada.cookie, { ...fields, request: crypto.randomUUID() })
  assert.match(await stale.text(), /decision changed/)
})

test('a standalone plan preserves source ownership and memberships when an editor creates it', async (t) => {
  const sourceDoc = await app.createDocument(ada.cookie, 'Standalone decision')
  await app.post(`/doc/${sourceDoc}`, ada.cookie, { intent: 'add', email: bea.email, role: 'editor' })
  await app.post(`/doc/${sourceDoc}`, ada.cookie, { intent: 'add', email: viewer.email, role: 'viewer' })
  const sourceTab = app.openTab(sourceDoc, ada.cookie); t.after(() => sourceTab.close())
  await until(() => sourceTab.provider.synced, 'standalone source synced')
  const block = new Y.XmlElement('decision'); block.setAttribute('decisionId', 'standalone-plan-source'); block.setAttribute('status', 'decided'); block.setAttribute('number', 0); block.insert(0, [new Y.XmlText('Publish the guide')])
  sourceTab.doc.getXmlFragment('document-store').push([block]); await until(() => Number(block.getAttribute('number')) > 0, 'standalone decision indexed')
  const source = (await data('standalone-plan-source', bea)).decision
  const draft = initialPlanDraft({ text: source.text, choice: source.text, reasoning: '' })
  const response = await app.post(`/decision/${source.id}`, bea.cookie, { intent: 'create-plan', request: crypto.randomUUID(), version: decisionPlanVersion(source), draft: JSON.stringify(draft) })
  assert.equal(response.status, 302, await response.clone().text())
  const id = response.headers.get('location').split('/').pop()
  for (const user of [ada, bea, viewer]) assert.equal((await get(`/doc/${id}`, user)).status, 200)
  assert.equal((await get(`/doc/${id}`, outsider)).status, 404)
  assert.equal((await graph('document', id, bea)).items.find((item) => item.kind === 'decision' && item.id === source.id)?.reason, 'Implements')
  assert.equal((await graph('decision', source.id, ada)).items.find((item) => item.kind === 'document' && item.id === id)?.reason, 'Implemented by')
})

test('the editor resolves inherited owners without exposing a private space roster to document-only readers', async () => {
  const team = await documentData(planId)
  assert.ok(team.editorMembers.some((member) => member.user_id === bea.id), 'space owners appear in task dropdowns')
  assert.ok(!team.members.some((member) => member.user_id === bea.id), 'inherited membership is not copied into direct sharing')
  await app.post(`/doc/${planId}`, ada.cookie, { intent: 'add', email: outsider.email, role: 'viewer' })
  const directOnly = await documentData(planId, outsider)
  assert.ok(directOnly.editorMembers.some((member) => member.user_id === outsider.id))
  assert.ok(!directOnly.editorMembers.some((member) => member.user_id === bea.id), 'private space members stay hidden')
  assert.equal((await get(`/decision/${decision.id}`, outsider)).status, 404, 'sharing the plan does not share the decision')
})
