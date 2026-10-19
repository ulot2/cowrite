import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { startApp, until } from './harness.js'

let app, ada, bea, viewer, outsider, space, document, room, docTab, question, card, decision
const ref = (kind, id) => ({ kind, id })
const graph = async (item, user = ada) => {
  const response = await fetch(`${app.base}/api/connections?${new URLSearchParams(item)}`, { headers: { cookie: user.cookie }, redirect: 'manual' })
  return { status: response.status, data: await response.json() }
}
const link = (item, target, user = ada, relation = 'related') => app.post('/api/connections', user.cookie, { ...item, intent: 'link', target: `${target.kind}:${target.id}`, relation })
const item = (data, kind, id) => data.items.find((n) => n.kind === kind && n.id === id)
const poll = async (fn) => {
  const end = Date.now() + 12000
  do { if (await fn()) return; await new Promise((r) => setTimeout(r, 100)) } while (Date.now() < end)
  assert.fail('Connected work did not reach the expected state')
}

before(async () => {
  app = await startApp()
  ada = await app.signUpUser('Ada'); bea = await app.signUpUser('Bea')
  viewer = await app.signUpUser('Viewer'); outsider = await app.signUpUser('Outsider')
  space = (await app.post('/?index', ada.cookie, { intent: 'new-space', name: 'Connected launch' })).headers.get('location').split('/').pop()
  for (const [person, role] of [[bea, 'editor'], [viewer, 'viewer']]) await app.post(`/space/${space}`, ada.cookie, { intent: 'add', email: person.email, role })
  document = (await app.post(`/space/${space}`, ada.cookie, { intent: 'create', mode: 'write' })).headers.get('location').split('/').pop()
  await app.post(`/doc/${document}`, ada.cookie, { intent: 'rename', title: 'First-week guide' })
  const session = await (await fetch(`${app.base}/api/auth/get-session`, { headers: { cookie: ada.cookie } })).json()
  const userId = session.user.id
  room = app.openTab(`space/${space}`, ada.cookie); docTab = app.openTab(document, ada.cookie)
  await until(() => room.provider.synced && docTab.provider.synced, 'rooms synced')
  question = new Y.Map(); card = new Y.Map()
  room.doc.transact(() => {
    room.doc.getMap('cards').set('seed-idea', card)
    card.set('text', 'Make a new teammate’s first week easier'); card.set('doc', document); card.set('discussion', 'launch-question')
    room.doc.getMap('discussions').set('launch-question', question)
    for (const [k, v] of Object.entries({ title: 'Guide or video first?', kind: 'question', status: 'answered', answer: 'Ship the guide first', createdBy: userId, createdAt: Date.now(), answeredBy: userId, idea: 'seed-idea' })) question.set(k, v)
    const posts = new Y.Array(); question.set('posts', posts)
    const post = new Y.Map(); post.set('id', 'post-1'); post.set('userId', userId); post.set('text', 'The guide helps everyone start.'); post.set('createdAt', Date.now()); posts.push([post])
    room.doc.getMap('tasks').set('launch-task', { text: 'Write the first-day checklist', assignee: userId, assigneeName: 'Ada', due: '', done: false, discussionId: 'launch-question', postId: 'post-1', createdBy: userId })
  })
  const block = new Y.XmlElement('task')
  block.setAttribute('taskId', 'doc-task'); block.setAttribute('done', false)
  block.insert(0, [new Y.XmlText('Check the welcome links')]); docTab.doc.getXmlFragment('document-store').push([block])
  await until(() => Number(question.get('decisionNumber')) > 0, 'decision indexed')
  decision = 'q:launch-question'
  await poll(async () => item((await graph(ref('document', document))).data, 'task', 'doc-task'))
})
after(() => { room?.close(); docTab?.close(); app?.stop() })

test('existing idea, discussion, decision and task provenance can be followed in both directions', async () => {
  const doc = (await graph(ref('document', document))).data
  assert.equal(item(doc, 'idea', `space/${space}:seed-idea`).reason, 'Started from')
  assert.equal(item(doc, 'discussion', 'launch-question').depth, 2)
  assert.equal(item(doc, 'decision', decision).depth, 3)
  assert.equal(item(doc, 'task', 'doc-task').reason, 'Contains')
  const source = (await graph(ref('idea', `space/${space}:seed-idea`))).data
  assert.equal(item(source, 'document', document).reason, 'Led to')
  assert.equal(item(source, 'discussion', 'launch-question').reason, 'Led to')
  const outcome = (await graph(ref('decision', decision))).data
  assert.equal(item(outcome, 'discussion', 'launch-question').reason, 'Started from')
  assert.ok(item(outcome, 'task', 'launch-task'))
})

test('documents and tasks explicitly implement a decision, with reciprocal labels and idempotent writes', async () => {
  for (const implementation of [ref('document', document), ref('task', 'launch-task')]) {
    assert.equal((await link(implementation, ref('decision', decision), ada, 'implements')).status, 200)
    assert.equal((await link(implementation, ref('decision', decision), ada, 'implements')).status, 200)
    const current = (await graph(implementation)).data
    assert.equal(item(current, 'decision', decision).reason, 'Implements')
    assert.equal(current.items.filter((n) => n.id === decision).length, 1)
  }
  const outcome = (await graph(ref('decision', decision))).data
  assert.equal(item(outcome, 'document', document).reason, 'Implemented by')
  assert.equal(item(outcome, 'task', 'launch-task').reason, 'Implemented by')
  assert.ok(item(outcome, 'task', 'launch-task').linkId)
})

test('connections survive source indexing and use current titles', async () => {
  question.set('due', '2031-05-04')
  await app.post(`/doc/${document}`, ada.cookie, { intent: 'rename', title: 'A confident first week' })
  await new Promise((r) => setTimeout(r, 3800))
  const outcome = (await graph(ref('decision', decision))).data
  assert.equal(item(outcome, 'document', document).label, 'A confident first week')
  assert.equal(item(outcome, 'task', 'launch-task').reason, 'Implemented by')
})

test('viewers can follow connections but cannot add or remove them; strangers learn no titles', async () => {
  const visible = await graph(ref('decision', decision), viewer)
  assert.equal(visible.status, 200); assert.equal(visible.data.canManage, false)
  assert.deepEqual(visible.data.candidates, [])
  assert.equal((await link(ref('decision', decision), ref('document', document), viewer)).status, 403)
  const explicit = item(visible.data, 'document', document).linkId
  assert.equal((await app.post('/api/connections', viewer.cookie, { kind: 'decision', id: decision, intent: 'unlink', link: explicit })).status, 403)
  const hidden = await graph(ref('decision', decision), outsider)
  assert.equal(hidden.status, 404)
  assert.doesNotMatch(JSON.stringify(hidden.data), /Guide or video|first week|checklist/)
})

test('a document-only reader cannot see its space, its hidden sources, or connections through them', async () => {
  await app.post(`/doc/${document}`, ada.cookie, { intent: 'add', email: outsider.email, role: 'viewer' })
  const visible = await graph(ref('document', document), outsider)
  assert.equal(visible.status, 200)
  assert.ok(item(visible.data, 'task', 'doc-task'))
  assert.equal(item(visible.data, 'decision', decision), undefined)
  assert.equal(item(visible.data, 'discussion', 'launch-question'), undefined)
  assert.equal(item(visible.data, 'idea', `space/${space}:seed-idea`), undefined)
  assert.doesNotMatch(JSON.stringify(visible.data), /Guide or video first|Make a new teammate/)
})

test('forged targets, invalid implementation types and self-links are rejected', async () => {
  const secret = await app.createDocument(outsider.cookie, 'Private acquisition notes')
  const forged = await link(ref('document', document), ref('document', secret))
  assert.equal(forged.status, 200); assert.ok((await forged.json()).error)
  const wrong = await link(ref('discussion', 'launch-question'), ref('decision', decision), ada, 'implements')
  assert.ok((await wrong.json()).error)
  assert.ok((await (await link(ref('document', document), ref('document', document))).json()).error)
  assert.doesNotMatch(JSON.stringify((await graph(ref('document', document))).data), /Private acquisition/)
})

test('removing a manual connection preserves the original source history', async () => {
  const outcome = (await graph(ref('decision', decision))).data
  const id = item(outcome, 'document', document).linkId
  const removed = await app.post('/api/connections', bea.cookie, { kind: 'decision', id: decision, intent: 'unlink', link: id })
  assert.equal(removed.status, 200)
  const after = await removed.json()
  assert.notEqual(item(after, 'document', document)?.depth, 1)
  assert.equal(item(after, 'discussion', 'launch-question').reason, 'Started from')
  assert.equal(item((await graph(ref('document', document))).data, 'idea', `space/${space}:seed-idea`).reason, 'Started from')
})

test('standalone boards expose old card-to-document backlinks only to people who can read the board', async () => {
  const board = (await app.post('/?index', ada.cookie, { intent: 'create', mode: 'brainstorm' })).headers.get('location').split('/').pop()
  const child = await app.createDocument(ada.cookie, 'Standalone guide')
  const tab = app.openTab(board, ada.cookie)
  try {
    await until(() => tab.provider.synced, 'board synced')
    const seed = new Y.Map()
    tab.doc.transact(() => {
      tab.doc.getMap('cards').set('original-card', seed)
      seed.set('text', 'Original brainstorm context'); seed.set('doc', child)
      seed.set('group', tab.doc.getArray('groups').get(0).id); seed.set('pos', 0); seed.set('votes', new Y.Map())
    })
    const id = `doc/${board}:original-card`
    await poll(async () => item((await graph(ref('document', child))).data, 'idea', id))
    assert.equal(item((await graph(ref('idea', id))).data, 'document', child).reason, 'Led to')
    await app.post(`/doc/${child}`, ada.cookie, { intent: 'add', email: bea.email, role: 'viewer' })
    const shared = (await graph(ref('document', child), bea)).data
    assert.equal(item(shared, 'idea', id), undefined)
    assert.doesNotMatch(JSON.stringify(shared), /Original brainstorm context/)
  } finally { tab.close() }
})

test('deleted work and deleted board provenance disappear rather than leaving broken links', async () => {
  const extra = (await app.post(`/space/${space}`, ada.cookie, { intent: 'create', mode: 'write' })).headers.get('location').split('/').pop()
  await link(ref('decision', decision), ref('document', extra))
  assert.ok(item((await graph(ref('decision', decision))).data, 'document', extra))
  await app.post('/documents', ada.cookie, { intent: 'delete', id: extra })
  assert.equal(item((await graph(ref('decision', decision))).data, 'document', extra), undefined)
  room.doc.getMap('cards').delete('seed-idea')
  await poll(async () => !item((await graph(ref('document', document))).data, 'idea', `space/${space}:seed-idea`))
  assert.equal((await graph(ref('idea', `space/${space}:seed-idea`))).status, 404)
})

test('replacement history has accurate labels and the older decision is marked replaced', async () => {
  const d = new Y.XmlElement('decision')
  d.setAttribute('decisionId', 'replacement'); d.setAttribute('status', 'decided'); d.setAttribute('number', 0)
  d.insert(0, [new Y.XmlText('Start with the revised guide')]); docTab.doc.getXmlFragment('document-store').push([d])
  await until(() => Number(d.getAttribute('number')) > 0, 'replacement indexed')
  assert.equal((await app.post('/decision/replacement', ada.cookie, { intent: 'supersede', older: decision })).status, 200)
  const older = (await graph(ref('decision', decision))).data
  assert.equal(older.anchor.status, 'replaced')
  assert.equal(item(older, 'decision', 'replacement').reason, 'Replaced by')
  assert.equal(item((await graph(ref('decision', 'replacement'))).data, 'decision', decision).reason, 'Replaces')
})

test('an explicit implementation can coexist with native provenance and be removed independently', async () => {
  const native = (await graph(ref('decision', 'replacement'))).data
  assert.ok(native.candidates.some((n) => n.kind === 'document' && n.id === document))
  await link(ref('document', document), ref('decision', 'replacement'), ada, 'implements')
  const combined = item((await graph(ref('decision', 'replacement'))).data, 'document', document)
  assert.match(combined.reason, /Implemented by/); assert.match(combined.reason, /Started from/)
  assert.ok(combined.linkId)
  await app.post('/api/connections', ada.cookie, { kind: 'decision', id: 'replacement', intent: 'unlink', link: combined.linkId })
  assert.equal(item((await graph(ref('decision', 'replacement'))).data, 'document', document).reason, 'Started from')
})
