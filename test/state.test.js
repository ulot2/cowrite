import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { startApp, until } from './harness.js'

// The harness starts the app with AI_FAKE: Nib's summary reads "AI state: <input length>", and a
// check of any text finds D-1.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ALARM = 3800

let app, ada, bea, cy, dee, adaId, spaceId, docId, room
before(async () => {
  app = await startApp()
  ;[ada, bea, cy, dee] = await Promise.all(['Ada', 'Bea', 'Cy', 'Dee'].map((n) => app.signUpUser(n)))
  adaId = (await (await fetch(`${app.base}/api/auth/get-session`, { headers: { cookie: ada.cookie } })).json()).user.id
  spaceId = (await app.post('/?index', ada.cookie, { intent: 'new-space', name: 'Launch' })).headers.get('location').split('/').pop()
  await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'add', email: bea.email, role: 'editor' })
  await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'add', email: cy.email, role: 'viewer' })

  // This week: a question answered (D-1), a late task from a discussion, and a document in review.
  room = app.openTab(`space/${spaceId}`, ada.cookie)
  await until(() => room.provider.synced, 'room synced')
  const d = new Y.Map(), posts = new Y.Array(), m = new Y.Map()
  room.doc.transact(() => {
    room.doc.getMap('discussions').set('q1', d)
    for (const [k, v] of Object.entries({ title: 'October or November?', kind: 'question', status: 'answered', answer: 'November.', answeredBy: 'x', createdBy: 'x', createdAt: Date.now() })) d.set(k, v)
    d.set('posts', posts)
    m.set('id', 'p1'); m.set('userId', 'x'); m.set('text', 'Security needs two more weeks.'); m.set('createdAt', Date.now())
    posts.push([m])
    room.doc.getMap('tasks').set('t1', { text: 'Send the brief', assignee: adaId, assigneeName: 'Ada', due: '2020-01-01', done: false, discussionId: 'q1', postId: 'p1', createdBy: 'x' })
  })
  await until(() => d.get('decisionNumber') === 1, 'D-1')
  docId = (await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'create', mode: 'write' })).headers.get('location').split('/').pop()
  const text = app.openTab(docId, ada.cookie)
  await until(() => text.provider.synced, 'doc synced')
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText('We launch in October.')])
  text.doc.getXmlFragment('document-store').push([p])
  await sleep(ALARM)
  text.close()
  await app.post(`/doc/${docId}`, ada.cookie, { intent: 'status', move: 'submit' })
})
after(() => { room.close(); app.stop() })

const page = async (path, cookie) => { const r = await fetch(app.base + path, { headers: { cookie } }); return { status: r.status, html: await r.text() } }
const waitFor = async (path, cookie, re, what) => {
  let html = ''
  for (let i = 0; i < 60 && !re.test(html); i++) { await sleep(200); html = (await page(path, cookie)).html }
  assert.match(html, re, what)
  return html
}

test('needs attention lists the late task and the document in review, once each; an empty space starts with Get started', async () => {
  const { html } = await page(`/space/${spaceId}`, bea.cookie)
  assert.match(html, /Needs attention/)
  assert.match(html, /data-verb="Do">Do<\/span><span class="attention-title">Send the brief</)
  assert.match(html, /data-verb="Review">Review<\/span><span class="attention-title">Untitled</)
  assert.equal(html.match(/class="attention-title">Send the brief</g).length, 1, 'the task is listed once')
  assert.doesNotMatch(html, /Get started/)
  assert.match((await page(`/space/${spaceId}`, ada.cookie)).html, /Send the brief<\/span><span class="attention-meta"><span class="you">You</, 'the assignee sees You')
  assert.equal((await page(`/space/${spaceId}`, dee.cookie)).status, 404, 'a stranger')

  // A space with nothing in it yet shows Get started above the rest.
  const fresh = (await app.post('/?index', ada.cookie, { intent: 'new-space', name: 'Empty' })).headers.get('location')
  assert.match((await page(fresh, ada.cookie)).html, /Get started/)
})

test('quick space creation stays private and opens its three starting actions without a tutorial document', async () => {
  for (const path of ['/?index']) {
    const response = await app.post(path, dee.cookie, { intent: 'new-space', name: '  Hiring  ', description: '  Find our next designer.  ' })
    assert.equal(response.status, 302)
    const target = response.headers.get('location')
    assert.match(target, /^\/space\/[\w-]+$/)
    const html = (await page(target, dee.cookie)).html
    for (const text of ['Hiring', 'Find our next designer.', 'Add an idea', 'Start a discussion', 'Write a document', 'Add people', 'only members can open it', 'No email is sent']) assert.ok(html.includes(text), text)
    assert.doesNotMatch(html, /Welcome to CoWrite/, 'no starter document is added without asking')
    assert.equal((await page(target, bea.cookie)).status, 404, 'a new space is private')
    const createdDoc = await app.post(target, dee.cookie, { intent: 'create', mode: 'write' })
    assert.equal(createdDoc.status, 302, 'the starting document action works')
    assert.equal((await page(createdDoc.headers.get('location'), dee.cookie)).status, 200)
  }
})

test('guided onboarding creates the welcome document, keeps teammate setup optional, and checks ownership', async () => {
  const response = await app.post('/welcome', cy.cookie, { intent: 'space', name: '  First project  ', description: '  Learn how we work together.  ' })
  assert.equal(response.status, 302)
  const next = response.headers.get('location')
  assert.match(next, /^\/welcome\?space=[\w-]+$/)
  const id = new URL(next, app.base).searchParams.get('space')
  const target = `/space/${id}`
  const people = (await page(next, cy.cookie)).html
  assert.match(people.replace(/<!--.*?-->/g, ''), /Step 2 of 2/)
  assert.match(people, /This step is optional/)
  assert.match(people, /Skip for now/)
  assert.equal((await app.post('/welcome', cy.cookie, { space: id })).headers.get('location'), target, 'no teammates required')
  const html = (await page(target, cy.cookie)).html
  assert.match(html, /Learn how we work together\./)
  for (const title of ['Name your space', 'Open the welcome document', 'Add an idea', 'Ask a question that needs a decision', 'Ask Nib about the space']) assert.ok(html.includes(title), title)
  assert.match(html, /<strong>1 of 5 done\.<\/strong>/)
  assert.equal((await page(target, bea.cookie)).status, 404, 'the tutorial space is private')
  const stranger = await fetch(`${app.base}${next}`, { headers: { cookie: bea.cookie }, redirect: 'manual' })
  assert.equal(stranger.headers.get('location'), '/welcome', 'another person cannot resume the owner step')
  assert.equal((await app.post('/welcome', bea.cookie, { space: id, email: ada.email, role: 'owner' })).status, 404)
  await app.post(target, cy.cookie, { intent: 'hide-start' })
  assert.doesNotMatch((await page(target, cy.cookie)).html, /id="start-title"/, 'hiding the checklist survives a reload')
})

test('teammates validate before adding anyone, and the guided checklist persists until its real steps are completed', async () => {
  const next = (await app.post('/welcome', dee.cookie, { intent: 'new-space', name: 'Guided launch' })).headers.get('location')
  const id = new URL(next, app.base).searchParams.get('space')
  const target = `/space/${id}`
  const people = new URLSearchParams([['space', id], ['email', 'nobody@example.test'], ['role', 'editor'], ['email', bea.email], ['role', 'commenter']])
  assert.equal((await app.post('/welcome', dee.cookie, people)).status, 200, 'a missing account keeps the setup form open')
  assert.equal((await page(target, bea.cookie)).status, 404, 'a failed batch does not add anyone')
  assert.equal((await app.post('/welcome', dee.cookie, { space: id, email: bea.email, role: 'commenter' })).headers.get('location'), target)
  assert.equal((await page(target, bea.cookie)).status, 200)
  assert.equal((await app.post(target, bea.cookie, { intent: 'create', mode: 'write' })).status, 403, 'the chosen role is respected')
  let html = (await page(target, dee.cookie)).html
  const welcome = html.match(/href="\/doc\/([\w-]+)"/)[1]
  const document = await page(`/doc/${welcome}`, dee.cookie)
  assert.equal(document.status, 200)
  const markdown = await (await fetch(`${app.base}/doc/${welcome}/export?format=md`, { headers: { cookie: dee.cookie } })).text()
  assert.match(markdown, /Finish the welcome document/, 'the welcome document has working tutorial content')
  html = (await page(target, dee.cookie)).html
  assert.match(html, /<strong>2 of 5 done\.<\/strong>/, 'opening the welcome document ticks its step')
  await app.post(target, dee.cookie, { intent: 'create', mode: 'write' })
  assert.match((await page(target, dee.cookie)).html, /<strong>2 of 5 done\.<\/strong>/, 'creating real work does not remove the checklist')
  // Let the space establish its initial activity snapshot before adding new work.
  await sleep(ALARM)
  const tutorial = app.openTab(`space/${id}`, dee.cookie)
  try {
    await until(() => tutorial.provider.synced, 'tutorial room synced')
    tutorial.doc.transact(() => {
      const idea = new Y.Map()
      tutorial.doc.getMap('cards').set('tutorial-idea', idea)
      for (const [key, value] of Object.entries({ text: 'Try a launch idea', group: 'new', pos: 1 })) idea.set(key, value)
      idea.set('votes', new Y.Map())
      const question = new Y.Map()
      tutorial.doc.getMap('discussions').set('tutorial-question', question)
      for (const [key, value] of Object.entries({ title: 'When do we launch?', kind: 'question', status: 'open', createdBy: 'x', createdAt: Date.now() })) question.set(key, value)
      question.set('posts', new Y.Array())
    })
    await waitFor(target, dee.cookie, /<strong>4 of 5 done\.<\/strong>/, 'ideas and questions tick themselves')
    await app.post(target, dee.cookie, { intent: 'ask', question: 'What should I try first?' })
    assert.doesNotMatch((await page(target, dee.cookie)).html, /id="start-title"/, 'the checklist finishes after asking Nib')
  } finally { tutorial.close() }
})

test('both creation entry points validate names and descriptions before writing a space', async () => {
  for (const path of ['/welcome', '/?index']) {
    for (const fields of [{ name: '  ' }, { name: 'N'.repeat(61) }, { name: 'Too long', description: 'D'.repeat(141) }]) {
      const response = await app.post(path, dee.cookie, { intent: 'new-space', ...fields })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('location'), null)
      assert.match(await response.text(), /Give the space a name|60 characters or fewer|140 characters or fewer/)
    }
  }
  assert.doesNotMatch((await page('/', dee.cookie)).html, /aria-label="Too long"/, 'invalid descriptions do not leave a space behind')
})

test('a member can leave a space; the owner cannot', async () => {
  const space = (await app.post('/?index', ada.cookie, { intent: 'new-space', name: 'Leaving' })).headers.get('location').split('/').pop()
  await app.post(`/space/${space}`, ada.cookie, { intent: 'add', email: cy.email, role: 'viewer' })
  assert.equal((await app.post(`/space/${space}`, ada.cookie, { intent: 'leave' })).status, 403, 'the owner')
  assert.equal((await app.post(`/space/${space}`, cy.cookie, { intent: 'leave' })).status, 302)
  assert.equal((await page(`/space/${space}`, cy.cookie)).status, 404, 'gone after leaving')
})

test('a visit writes Nib\'s summary in the room; a second visit within hours does not start another', async () => {
  await waitFor(`/space/${spaceId}`, ada.cookie, /AI state: \d+/, 'the summary is written')
  const again = (await page(`/space/${spaceId}`, ada.cookie)).html
  assert.doesNotMatch(again, /Nib is catching up/, 'not due again yet')
})

test('Refresh needs a commenter or up, and not again within ten minutes', async () => {
  assert.equal((await app.post(`/space/${spaceId}`, cy.cookie, { intent: 'state' })).status, 403, 'a viewer')
  const r = await fetch(`${app.base}/space/${spaceId}.data`, { method: 'POST', body: new URLSearchParams({ intent: 'state' }), headers: { cookie: ada.cookie } })
  assert.match(await r.text(), /a few minutes ago/)
})

test('activity rows link to their discussion and decision; ideas and ticks are recorded; Nib\'s check too', async () => {
  const card = new Y.Map()
  room.doc.transact(() => {
    room.doc.getMap('cards').set('c1', card)
    card.set('text', 'Partner webinar'); card.set('group', 'g'); card.set('pos', 1); card.set('votes', new Y.Map())
  })
  const t = room.doc.getMap('tasks').get('t1')
  room.doc.getMap('tasks').set('t1', { ...t, done: true })
  const html = await waitFor(`/space/${spaceId}`, ada.cookie, /added an idea: “Partner webinar”/, 'the idea is logged')
  assert.match(html, /completed “Send the brief”/, 'the tick in the room is logged')
  assert.match(html, /tab=discussions(&|&amp;|\\u0026)d=q1/, 'a discussion event links to its thread')
  assert.match(html, /\/decision\/q:q1/, 'the decision event links to its record')
  assert.match(html, /found a conflict with the decisions/, 'Nib\'s check is on the record')
})
