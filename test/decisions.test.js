import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { startApp, until } from './harness.js'
import { emptyDecisionBrief, readDecisionBrief, recordDecision, saveDecisionBrief } from '../app/lib/decision-brief.ts'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ALARM = 3800

let app, ada, bea, cy, dee, spaceId, docId
before(async () => {
  app = await startApp()
  ada = await app.signUpUser('Ada')
  bea = await app.signUpUser('Bea')
  cy = await app.signUpUser('Cy')
  dee = await app.signUpUser('Dee')
  spaceId = (await app.post('/?index', ada.cookie, { intent: 'new-space', name: 'Launch' })).headers.get('location').split('/').pop()
  await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'add', email: bea.email, role: 'editor' })
  await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'add', email: cy.email, role: 'viewer' })
})
after(() => app.stop())

const page = async (path, cookie) => { const r = await fetch(app.base + path, { headers: { cookie }, redirect: 'manual' }); return { status: r.status, html: (await r.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '') } }

test('an answered question becomes D-1, numbered back into the room, with the thread as its reason', async () => {
  const tab = app.openTab(`space/${spaceId}`, ada.cookie)
  await until(() => tab.provider.synced, 'synced')
  const d = new Y.Map()
  const posts = new Y.Array()
  tab.doc.transact(() => {
    tab.doc.getMap('discussions').set('q1', d)
    for (const [k, v] of Object.entries({ title: 'October or November?', kind: 'question', status: 'open', createdBy: 'x', createdAt: Date.now() })) d.set(k, v)
    d.set('posts', posts)
    const p = new Y.Map()
    p.set('id', 'p1'); p.set('userId', 'x'); p.set('text', 'The security review needs two more weeks.'); p.set('createdAt', Date.now())
    posts.push([p])
    assert.equal(saveDecisionBrief(d, { context: 'The launch must leave room for the security review.', options: [
      { id: 'oct', title: 'Launch in October', benefits: 'Earlier feedback', tradeoffs: 'An unfinished security review' },
      { id: 'nov', title: 'Launch in November', benefits: 'A reviewed release', tradeoffs: 'Two weeks later' },
    ], recommendation: 'nov', reasoning: 'Finish the review before we invite customers.' }, emptyDecisionBrief()), null)
  })
  await sleep(ALARM)
  // The page also carries its loader data, so check the rendered log rows, not any text.
  assert.doesNotMatch((await page(`/space/${spaceId}?tab=decisions`, ada.cookie)).html, /class="decision-number"/, 'an open question is not a decision')

  assert.equal(recordDecision(d, { optionId: '', choice: 'November 12, after the security review.', reasoning: 'We accept the later launch to complete the security review.' }, readDecisionBrief(d.get('brief')), 'x'), null)
  await until(() => d.get('decisionNumber') === 1, 'the number is written into the room')
  tab.close()

  const log = (await page(`/space/${spaceId}?tab=decisions`, ada.cookie)).html
  assert.match(log, /class="decision-number"[^>]*>D-1</)
  const record = await page('/decision/q:q1', bea.cookie)
  assert.equal(record.status, 200)
  assert.match(record.html, /November 12, after the security review\./)
  assert.match(record.html, /The security review needs two more weeks\./, 'the discussion is the reason')
  assert.match(record.html, /Brief at the time of the decision/)
  assert.match(record.html, /We accept the later launch to complete the security review\./)
  for (const text of ['Launch in October', 'An unfinished security review', 'Launch in November', 'Finish the review before we invite customers.']) assert.ok(record.html.includes(text), `the decision record keeps ${text}`)
  assert.match((await page('/decision/q:q1', cy.cookie)).html, /Launch in November/, 'a viewer can read the brief')
  assert.equal((await page('/decision/q:q1', dee.cookie)).status, 404, 'a stranger')
})

test('a decision block in a space document takes the next number, D-2', async () => {
  docId = (await app.post(`/space/${spaceId}`, ada.cookie, { intent: 'create', mode: 'write' })).headers.get('location').split('/').pop()
  const tab = app.openTab(docId, ada.cookie)
  await until(() => tab.provider.synced, 'synced')
  const el = new Y.XmlElement('decision')
  el.setAttribute('decisionId', 'd-2'); el.setAttribute('status', 'decided'); el.setAttribute('number', 0)
  el.insert(0, [new Y.XmlText('Launch on November 12')])
  tab.doc.getXmlFragment('document-store').push([el])
  await until(() => Number(el.getAttribute('number')) === 2, 'D-2 written into the block')
  tab.close()
  const record = await page('/decision/d-2', bea.cookie)
  assert.equal(record.status, 200)
  assert.match(record.html, /Launch on November 12/)
  assert.match(record.html, /Recorded in the document/)
})

test('D-2 replaces D-1: D-1 says so, the log in force hides it; viewers and cycles are refused', async () => {
  assert.equal((await app.post('/decision/d-2', cy.cookie, { intent: 'supersede', older: 'q:q1' })).status, 403, 'a viewer')
  assert.equal((await app.post('/decision/d-2', bea.cookie, { intent: 'supersede', older: 'q:q1' })).status, 200)
  const older = (await page('/decision/q:q1', ada.cookie)).html
  assert.match(older, /replaced by/i)
  assert.match(older, /D-2/)
  assert.match((await page('/decision/d-2', ada.cookie)).html, /Replaces/)
  const log = (await page(`/space/${spaceId}?tab=decisions`, ada.cookie)).html
  assert.match(log, />D-2</)
  assert.doesNotMatch(log, /data-replaced/, 'in force hides the replaced one')

  const cycle = await fetch(`${app.base}/decision/q:q1.data`, { method: 'POST', body: new URLSearchParams({ intent: 'supersede', older: 'd-2' }), headers: { cookie: ada.cookie } })
  assert.match(await cycle.text(), /already/)
})

test('reopening preserves a snapshot; rerecording appends history; reindexing cannot rewrite it', async (t) => {
  const tab = app.openTab(`space/${spaceId}`, ada.cookie)
  t.after(() => tab.close())
  await until(() => tab.provider.synced, 'recording room synced')
  const d = tab.doc.getMap('discussions').get('q1')
  const first = d.get('recording')
  d.set('status', 'open')
  await sleep(ALARM)
  const before = readDecisionBrief(d.get('brief'))
  assert.equal(saveDecisionBrief(d, { ...before, context: 'An entirely different deadline after reopening.' }, before), null)
  await sleep(ALARM)
  const reopened = (await page('/decision/q:q1', cy.cookie)).html
  assert.match(reopened, /This question is open again/)
  assert.match(reopened, /The launch must leave room for the security review\./)
  assert.doesNotMatch(reopened, /An entirely different deadline after reopening\./, 'a saved brief never reads live context')
  assert.match(reopened, /November 12, after the security review\./)
  assert.equal(recordDecision(d, { optionId: 'oct', choice: '', reasoning: 'The review is complete, so we can accept the faster schedule.' }, readDecisionBrief(d.get('brief')), 'x'), null)
  const second = d.get('recording')
  await sleep(ALARM)
  const revised = (await page('/decision/q:q1', cy.cookie)).html
  assert.match(revised, /Earlier recorded versions/)
  assert.match(revised, /An entirely different deadline after reopening\./)
  assert.match(revised, /We accept the later launch to complete the security review\./, 'the earlier rationale stays in history')
  assert.match(revised, /Decision D-1/)
  d.set('status', 'open')
  assert.equal(recordDecision(d, { optionId: '', choice: 'A smaller October launch', reasoning: 'Limit the initial audience and keep the schedule.' }, readDecisionBrief(d.get('brief')), 'x'), null)
  d.set('status', 'open') // both transitions occur before the index alarm
  await sleep(ALARM)
  const rapid = (await page('/decision/q:q1', ada.cookie)).html
  assert.match(rapid, /class="outcome"[\s\S]*?A smaller October launch/)
  assert.match(rapid, /This question is open again/)
  assert.match(rapid, /The review is complete, so we can accept the faster schedule\./)
  d.set('status', 'answered')
  await sleep(ALARM)
  const latest = d.get('recording')
  tab.doc.transact(() => {
    d.set('recording', { ...latest, choice: 'An overwritten choice', optionId: '', reasoning: 'An overwritten reason', brief: emptyDecisionBrief() })
    d.set('answer', 'An overwritten choice'); d.set('title', 'An overwritten title')
  })
  await sleep(ALARM)
  const unchanged = (await page('/decision/q:q1', ada.cookie)).html
  assert.doesNotMatch(unchanged, /An overwritten choice|An overwritten reason/, 'the persisted payload is immutable')
  assert.match(unchanged, /Limit the initial audience and keep the schedule\./)
  d.set('recording', first)
  await sleep(ALARM)
  const replayed = (await page('/decision/q:q1', ada.cookie)).html
  assert.match(replayed, /Limit the initial audience and keep the schedule\./, 'an older recording cannot become current through replay')
  tab.doc.getMap('discussions').delete('q1')
  await sleep(ALARM)
  const deleted = (await page('/decision/q:q1', ada.cookie)).html
  assert.match(deleted, /The discussion behind this decision is gone/)
  assert.match(deleted, /An entirely different deadline after reopening\./, 'snapshot survives removal of source discussion')
  assert.match(deleted, /Earlier recorded versions/)
})

test('legacy answers still have a record and clearly label their unsnapshotted source brief', async (t) => {
  const tab = app.openTab(`space/${spaceId}`, ada.cookie)
  t.after(() => tab.close())
  await until(() => tab.provider.synced, 'legacy room synced')
  const d = new Y.Map()
  tab.doc.transact(() => {
    tab.doc.getMap('discussions').set('legacy', d)
    for (const [key, value] of Object.entries({ title: 'An older answer', kind: 'question', status: 'open', createdBy: 'x', createdAt: Date.now() })) d.set(key, value)
    saveDecisionBrief(d, { ...emptyDecisionBrief(), context: 'Current context for a legacy answer.' }, emptyDecisionBrief())
    d.set('answer', 'The original plain answer'); d.set('answeredBy', 'x'); d.set('status', 'answered')
  })
  await until(() => d.get('decisionNumber') > 0, 'legacy answer numbered')
  const record = (await page('/decision/q:legacy', cy.cookie)).html
  assert.match(record, /The original plain answer/)
  assert.match(record, /This older decision has no saved brief snapshot/)
  assert.doesNotMatch(record, /Brief at the time of the decision/)
  d.set('status', 'open')
  await sleep(ALARM)
  assert.equal(recordDecision(d, { optionId: '', choice: 'The new explicit choice', reasoning: 'We reconsidered the original answer.' }, readDecisionBrief(d.get('brief')), 'x'), null)
  await sleep(ALARM)
  const revised = (await page('/decision/q:legacy', cy.cookie)).html
  assert.match(revised, /The original plain answer/, 'the original plain answer stays in history')
  assert.match(revised, /Original plain answer\. A separate rationale and brief snapshot were not recorded\./)
  assert.match(revised, /The new explicit choice/)
})
