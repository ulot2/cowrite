import { lazy, Suspense, useEffect, useState } from 'react'
import { Form, Link, redirect, useFetcher, useRevalidator, useSearchParams } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { createInMode, listSpaceDocuments, type Mode } from '~/lib/db.server'
import { docStub } from '~/lib/versions.server'
import { askSpace, proposeNextSteps } from '~/lib/nib.server'
import { AiLimit, MAX_INSTRUCTION } from '~/lib/ai.server'
import type { Source } from '~/lib/search.server'
import { getSavedState, markStatePending, REFRESH_EVERY, spaceState, stateDue, type SavedState, type SpaceState } from '~/lib/state.server'
import { deleteSpace, createShareLink, findUser, findUserByEmail, getShareLink, getSpace, listMembers, removeMember, revokeShareLink, roleOnSpace, setMember, setSpaceVisibility } from '~/lib/access.server'
import { listSpaceDecisions } from '~/lib/work.server'
import { listOpenQuestions, listRecentDiscussions, listSpaceTasks } from '~/lib/discussions.server'
import { atLeast } from '~/lib/roles'
import { timeAgo } from '~/lib/time'
import { listSpaceEvents, logEvent, logSpaceEvent } from '~/lib/events.server'
import { Activity } from '~/components/activity'
import type { Role } from '~/lib/roles'
import { colorFor } from '~/lib/color'
import { Avatar } from '~/components/avatar'
import { DocCard } from '~/components/doc-card'
import { Icon } from '~/components/icon'
import { NewMenu } from '~/components/new-menu'
import { Confirm } from '~/components/confirm'
import { ShareDialog } from '~/components/share-dialog'
import type { Route } from './+types/space'

const SpaceRoom = lazy(() => import('~/components/space-room.client').then((m) => ({ default: m.SpaceRoom })))
const Board = lazy(() => import('~/components/board.client').then((m) => ({ default: m.Board })))

export const meta = ({ loaderData }: Route.MetaArgs) => [{ title: `${loaderData?.space.name ?? 'Space'} · cowrite` }]

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const role = await roleOnSpace(user.id, params.id)
  const space = role && await getSpace(params.id)
  if (!role || !space) throw new Response('Not found', { status: 404 })
  const isOwner = role === 'owner'
  // The ideas board lives in the space room. Its columns appear the first time a writer opens it.
  const tab = new URL(request.url).searchParams.get('tab')
  if (tab === 'ideas' && atLeast(role, 'commenter')) await docStub(`${params.id}:space`).seed('ideas')
  // The state of the space: live facts, and Nib's saved summary, written again in the room when due.
  const saved = await getSavedState(params.id)
  if ((!tab || tab === 'overview') && user.settings.nib && await stateDue(params.id, saved)) {
    await markStatePending(params.id)
    await docStub(`${params.id}:space`).requestState()
    saved.state = 'pending'
  }
  return {
    owner: { name: user.name, color: user.color, image: user.image },
    me: { id: user.id, name: user.name, color: user.color },
    nib: user.settings.nib,
    state: { saved, facts: await spaceState(params.id) },
    space, role, isOwner,
    questions: await listOpenQuestions(params.id),
    discussions: await listRecentDiscussions(params.id),
    tasks: await listSpaceTasks(params.id),
    documents: await listSpaceDocuments(params.id, role),
    members: await listMembers('space', params.id),
    link: isOwner ? await getShareLink('space', params.id) : null,
    events: await listSpaceEvents(params.id),
    decisions: await listSpaceDecisions(params.id),
  }
}

const grantable: Role[] = ['viewer', 'commenter', 'reviewer', 'editor']

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request)
  const f = await request.formData()
  const intent = String(f.get('intent'))
  const role = await roleOnSpace(user.id, params.id)
  if (intent === 'state') {
    // Refresh Nib's summary now, at most once every 10 minutes per space.
    if (!role) throw new Response('Not found', { status: 404 })
    if (!atLeast(role, 'commenter')) throw new Response('Commenters and up can refresh the summary', { status: 403 })
    if (!user.settings.nib) return { error: 'Nib is off in your settings.' }
    const saved = await getSavedState(params.id)
    if (saved.state === 'pending') return null
    if (saved.at && Date.now() - saved.at < REFRESH_EVERY) return { error: 'Nib updated this a few minutes ago. Try again later.' }
    await markStatePending(params.id)
    await docStub(`${params.id}:space`).requestState()
    return null
  }
  if (intent === 'ask' || intent === 'propose') {
    // Nib reads the space. Any member may ask (it changes nothing); next steps need a writer.
    if (!role) throw new Response('Not found', { status: 404 })
    if (!user.settings.nib) return { error: 'Nib is off in your settings.' }
    if (intent === 'propose' && !atLeast(role, 'commenter')) throw new Response('Commenters and up can ask for next steps', { status: 403 })
    try {
      if (intent === 'ask') {
        const question = String(f.get('question') ?? '').trim()
        if (!question) return { error: 'Ask a question first.' }
        if (question.length > MAX_INSTRUCTION) return { error: `Keep the question under ${MAX_INSTRUCTION} characters.` }
        return { question, ...(await askSpace(params.id, question)) }
      }
      const discussion = String(f.get('discussion') ?? '')
      const proposal = await proposeNextSteps(params.id, discussion)
      return proposal ? { discussion, proposal } : { error: 'This discussion is gone.' }
    } catch (e) {
      if (e instanceof AiLimit) return { error: 'Nib is out of free uses for today. Try again tomorrow.' }
      console.error(e)
      return { error: 'Nib did not answer. Try again.' }
    }
  }
  if (intent === 'create') {
    if (role !== 'owner' && role !== 'editor') throw new Response('Editors can add documents', { status: 403 })
    const { id, title } = await createInMode(user.id, String(f.get('mode') ?? 'write') as Mode, params.id)
    await logEvent(id, user.id, 'created', `created “${title}”`)
    throw redirect(`/doc/${id}`)
  }
  if (intent === 'card-doc') {
    // An idea on the board becomes a document in the space, in the Idea state.
    if (role !== 'owner' && role !== 'editor') throw new Response('Editors can add documents', { status: 403 })
    const { id, title } = await createInMode(user.id, 'write', params.id, String(f.get('title') ?? '').trim().slice(0, 120) || 'Untitled', 'idea')
    await logEvent(id, user.id, 'created', `created “${title}” from an idea`)
    return { created: id }
  }
  if (role !== 'owner') throw new Response('Only the owner can change the space', { status: 403 })
  if (intent === 'delete-space') {
    await deleteSpace(params.id)
    throw redirect('/')
  }
  const pick = String(f.get('role'))
  const granted = grantable.includes(pick as Role) ? (pick as Role) : 'viewer'
  switch (intent) {
    case 'add': {
      const person = await findUserByEmail(String(f.get('email') ?? ''))
      if (!person) return { error: 'No account has that email. Ask them to sign up first.' }
      if (person.id !== user.id) {
        await setMember('space', params.id, person.id, granted)
        await logSpaceEvent(params.id, user.id, 'shared', `added ${person.name} as ${granted}`)
      }
      return null
    }
    case 'role': case 'remove': {
      const person = await findUser(String(f.get('user_id')))
      if (!person) return null
      if (intent === 'role') await setMember('space', params.id, person.id, granted)
      else await removeMember('space', params.id, person.id)
      await logSpaceEvent(params.id, user.id, 'shared', intent === 'role' ? `made ${person.name} ${granted}` : `removed ${person.name}`)
      return null
    }
    case 'link-create': await createShareLink('space', params.id, granted, user.id); await logSpaceEvent(params.id, user.id, 'shared', `created a ${granted} link`); return null
    case 'link-revoke': await revokeShareLink('space', params.id); await logSpaceEvent(params.id, user.id, 'shared', 'revoked the link'); return null
    case 'visibility': {
      const visibility = f.get('visibility') === 'public' ? 'public' : 'private'
      await setSpaceVisibility(params.id, visibility)
      await logSpaceEvent(params.id, user.id, 'space', `made the space ${visibility}`)
      return null
    }
  }
  return null
}

const sourceIcon = { decision: 'check', question: 'comment', document: 'docs', discussion: 'comment', ideas: 'board' } as const

// "Ask Nib about this space": the answer cites its sources as [1], [2]; each becomes a link.
function AskSpace() {
  const fetcher = useFetcher<{ question?: string; answer?: string; sources?: Source[]; error?: string }>()
  const busy = fetcher.state !== 'idle'
  const out = fetcher.data
  const link = (n: number) => out?.sources?.find((x) => x.n === n)
  return (
    <section className="ask-space" aria-labelledby="ask-title">
      <h2 id="ask-title" className="sr-only">Ask Nib about this space</h2>
      <fetcher.Form method="post" className="ask-space-form">
        <input type="hidden" name="intent" value="ask" />
        <span className="ai-mark" aria-hidden="true">✦</span>
        <input name="question" required maxLength={500} placeholder="Ask Nib about this space, like “When do we launch?”" aria-label="Ask Nib about this space" disabled={busy} />
        <button className="primary" disabled={busy} aria-busy={busy}>{busy ? <span className="spinner" aria-hidden="true" /> : 'Ask'}</button>
      </fetcher.Form>
      {busy && <p className="muted small" role="status">Nib is reading the space…</p>}
      {!busy && out?.error && <p className="error small" role="alert">{out.error}</p>}
      {!busy && out?.answer && (
        <div className="ask-answer" role="status">
          <p className="ask-question">{out.question}</p>
          <p>{out.answer.split(/(\[\d+\])/).map((part, i) => {
            const s = /^\[(\d+)\]$/.test(part) ? link(Number(part.slice(1, -1))) : undefined
            return s ? <Link key={i} to={s.href} className="cite" title={s.title} aria-label={`Source ${s.n}: ${s.title}`}>{s.n}</Link> : part
          })}</p>
          {out.sources && out.sources.length > 0 && (
            <ol className="ask-sources" aria-label="Sources">
              {out.sources.map((x) => <li key={x.n}><Link to={x.href}><span className="cite" aria-hidden="true">{x.n}</span><Icon name={sourceIcon[x.kind]} />{x.title}</Link></li>)}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}

// "This week": Nib's summary over the live facts, each fact a link to what needs attention.
function ThisWeek({ saved, facts, spaceId, canRefresh, go }: { saved: SavedState; facts: SpaceState; spaceId: string; canRefresh: boolean; go: (t: Tab, d?: string | null) => void }) {
  const refresh = useFetcher<{ error?: string } | null>()
  const revalidator = useRevalidator()
  const pending = saved.state === 'pending' || refresh.state !== 'idle'
  useEffect(() => {
    if (saved.state !== 'pending') return
    const t = window.setInterval(() => { if (revalidator.state === 'idle') revalidator.revalidate() }, 3000)
    return () => clearInterval(t)
  }, [saved.state, revalidator])
  const q = facts.questions
  const chips: { key: string; label: string; tone?: 'warn' | 'danger' | 'ok'; to?: string; onClick?: () => void }[] = [
    facts.decided.length ? { key: 'decided', label: `${facts.decided.length} decided`, tone: 'ok' as const, to: facts.decided.length === 1 ? `/decision/${facts.decided[0].id}` : undefined, onClick: facts.decided.length === 1 ? undefined : () => go('decisions') } : null,
    q.open ? { key: 'questions', label: `${q.open} open ${q.open === 1 ? 'question' : 'questions'}${q.late ? ` · ${q.late} late` : ''}`, tone: q.late ? 'danger' as const : 'warn' as const, onClick: () => go('discussions', q.open === 1 ? q.next?.id : null) } : null,
    facts.lateTasks.length ? { key: 'tasks', label: `${facts.lateTasks.length} late ${facts.lateTasks.length === 1 ? 'task' : 'tasks'}`, tone: 'danger' as const, onClick: () => go('tasks') } : null,
    facts.review.length ? { key: 'review', label: `${facts.review.length} waiting for review${facts.review.some((d) => d.concerns) ? ' · concerns' : ''}`, tone: 'warn' as const, to: facts.review.length === 1 ? `/doc/${facts.review[0].id}` : undefined, onClick: facts.review.length === 1 ? undefined : () => go('documents') } : null,
    facts.fresh.ideas ? { key: 'ideas', label: `${facts.fresh.ideas} new ${facts.fresh.ideas === 1 ? 'idea' : 'ideas'}`, onClick: () => go('ideas') } : null,
  ].filter((c) => c !== null)
  const quiet = chips.length === 0
  return (
    <section className="this-week" aria-labelledby="week-title" data-pending={pending || undefined}>
      <div className="block-head">
        <h2 id="week-title">This week</h2>
        <span className="muted small">
          {pending ? 'Nib is catching up…' : saved.at ? `Updated ${timeAgo(saved.at)}` : ''}
          {canRefresh && !pending && <> · <button type="button" className="link-button" onClick={() => refresh.submit({ intent: 'state' }, { method: 'post' })}>Refresh</button></>}
        </span>
      </div>
      {saved.text
        ? <p className="week-text"><span className="ai-mark" aria-hidden="true">✦ </span>{saved.text}</p>
        : !pending && <p className="week-text muted">{quiet ? 'A quiet week. Nothing was decided, and nothing is late.' : 'Nib has not summed up this space yet.'}</p>}
      {saved.state === 'failed' && !pending && <p className="muted small" role="status">Nib could not update this summary. The facts below are current.</p>}
      {refresh.data?.error && <p className="error small" role="alert">{refresh.data.error}</p>}
      {chips.length > 0 && (
        <ul className="week-facts" aria-label="This week in numbers">
          {chips.map((c) => <li key={c.key} data-tone={c.tone}>{c.to ? <Link to={c.to}>{c.label}</Link> : <button type="button" onClick={c.onClick}>{c.label}</button>}</li>)}
        </ul>
      )}
    </section>
  )
}

const tabs = [['overview', 'Overview'], ['ideas', 'Ideas'], ['discussions', 'Discussions'], ['documents', 'Documents'], ['decisions', 'Decisions'], ['tasks', 'Tasks']] as const
type Tab = (typeof tabs)[number][0]
const day = (d: string) => new Date(d + 'T00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })
const today = () => new Date().toISOString().slice(0, 10)

export default function Space({ loaderData }: Route.ComponentProps) {
  const { owner, me, nib, state, space, role, isOwner, documents, members, link, events, decisions, questions, discussions, tasks } = loaderData
  const [params, setParams] = useSearchParams()
  const tab = (tabs.some(([t]) => t === params.get('tab')) ? params.get('tab') : 'overview') as Tab
  const go = (t: Tab, d?: string | null) => setParams(d ? { tab: t, d } : t === 'overview' ? {} : { tab: t }, { preventScrollReset: true })
  const people = members.map((m) => ({ id: m.user_id, name: m.name, color: colorFor(m.user_id, m.color), image: m.image }))
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const count: Partial<Record<Tab, number>> = { discussions: questions.length, documents: documents.length, decisions: decisions.filter((d) => !d.replaced_by).length, tasks: tasks.length }

  // Each decision links to its record. Replaced ones read struck through, with what replaced them.
  const decisionList = (list: typeof decisions) => (
    <ol className="decision-rows">
      {list.map((d) => (
        <li key={d.id} data-status={d.status} data-replaced={d.replaced_by ? true : undefined}>
          <Link className="decision-number" to={`/decision/${d.id}`}>{`D-${d.number}`}</Link>
          <span className="decision-log-text">
            <Link to={`/decision/${d.id}`}>{d.text || 'Untitled decision'}</Link>
            {d.outcome && <span className="decision-outcome">{d.outcome}</span>}
            <span className="decision-source">
              {d.source_type === 'discussion' ? <><Icon name="comment" />From a discussion</> : <><Icon name="docs" />{d.title}</>}
              {d.replaced_by && <> · replaced by <Link to={`/decision/${d.replaced_by}`}>{`D-${d.replaced_by_number}`}</Link></>}
            </span>
          </span>
          <span className="status" data-status={d.replaced_by ? 'draft' : d.status === 'decided' ? 'approved' : d.status === 'proposed' ? 'review' : 'draft'}>{d.replaced_by ? 'Replaced' : d.status[0].toUpperCase() + d.status.slice(1)}</span>
        </li>
      ))}
    </ol>
  )
  const [allDecisions, setAllDecisions] = useState(false)
  const inForce = decisions.filter((d) => !d.replaced_by)
  const taskList = (list: typeof tasks) => (
    <ul className="space-tasks">
      {list.map((t) => (
        <li key={t.id} data-late={(t.due && t.due < today()) || undefined}>
          <span className="space-task-text">{t.text || 'Untitled task'}</span>
          {t.discussion_id
            ? <button type="button" className="link-button" onClick={() => go('discussions', t.discussion_id)}><Icon name="comment" />{t.source}</button>
            : <Link to={`/doc/${t.document_id}`}><Icon name="docs" />{t.source}</Link>}
          {t.assignee_id && <Avatar name={t.assignee ?? '?'} color={colorFor(t.assignee_id, members.find((m) => m.user_id === t.assignee_id)?.color)} size={22} />}
          {t.due && <time dateTime={t.due}>{day(t.due)}</time>}
        </li>
      ))}
    </ul>
  )

  return (
    <div className="page space-page">
      <div className="doc-bar">
        <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">Home</Link><span aria-hidden="true">/</span><span>{space.name}</span></nav>
        <div className="doc-tools">
          {isOwner && (
            <Form method="post">
              <input type="hidden" name="intent" value="visibility" />
              <input type="hidden" name="visibility" value={space.visibility === 'public' ? 'private' : 'public'} />
              <button className="tool"><Icon name={space.visibility === 'public' ? 'lock' : 'globe'} /><span className="tool-label">{space.visibility === 'public' ? 'Make private' : 'Make public'}</span></button>
            </Form>
          )}
          {isOwner && (
            <Confirm title={`Delete “${space.name}”?`} confirm="Delete space" busy="Deleting…" fields={{ intent: 'delete-space' }}
              trigger={(open) => <button type="button" className="tool danger" title="Delete space" onClick={open}><Icon name="trash" /><span className="tool-label">Delete space</span></button>}>
              <p>The space, its members, its discussions, and its share link go away. This cannot be undone.</p>
              <ul>
                <li><strong>{documents.length} {documents.length === 1 ? 'document is' : 'documents are'} kept.</strong> They move out of the space and stay with the people added to them.</li>
                <li>People who could open them only through this space lose access.</li>
              </ul>
            </Confirm>
          )}
          <ShareDialog target="space" isOwner={isOwner} members={members} link={link} className="tool" />
        </div>
      </div>
      <header className="page-title">
        <p className="eyebrow">{space.visibility === 'public' ? 'Public space' : 'Private space'}</p>
        <h1>{space.name}</h1>
        <div className="title-meta">
          <span className="avatars" aria-hidden="true">{members.slice(0, 5).map((m) => <Avatar key={m.user_id} name={m.name} color={colorFor(m.user_id, m.color)} image={m.image} size={26} />)}</span>
          <p className="muted">{members.length} {members.length === 1 ? 'member' : 'members'} · {space.visibility === 'public' ? 'anyone with the link can view' : 'only members can open it'}</p>
          {(role === 'owner' || role === 'editor') && <span className="title-action"><NewMenu action="" /></span>}
        </div>
      </header>

      <nav className="space-tabs" aria-label="Space sections">
        {tabs.map(([t, label]) => (
          <button key={t} type="button" aria-current={tab === t ? 'page' : undefined} onClick={() => go(t)}>
            {label}{count[t] ? <span className="count">{count[t]}</span> : null}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="overview">
          {nib && <AskSpace />}
          <ThisWeek saved={state.saved} facts={state.facts} spaceId={space.id} canRefresh={nib && atLeast(role, 'commenter')} go={go} />
          <section className="overview-block questions" aria-labelledby="q-title">
            <div className="block-head"><h2 id="q-title">Open questions</h2><button type="button" className="link-button" onClick={() => go('discussions')}>All discussions</button></div>
            {questions.length === 0 ? <p className="muted">No question is waiting for a decision. Ask one in Discussions when something needs deciding.</p> : (
              <ul className="question-rows">
                {questions.map((q) => {
                  const late = q.due && q.due < today()
                  return (
                    <li key={q.id} data-late={late || undefined}>
                      <button type="button" onClick={() => go('discussions', q.id)}>
                        <span className="q-mark" aria-hidden="true">?</span>
                        <strong>{q.title}</strong>
                        <span className="question-who">{q.owner_id && <Avatar name={q.owner ?? '?'} color={colorFor(q.owner_id, members.find((m) => m.user_id === q.owner_id)?.color)} size={20} />}{q.owner ?? 'Nobody'}</span>
                        <span className="question-due">{q.due ? `${late ? 'Was due' : 'Decide by'} ${day(q.due)}` : 'No date'}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
          <div className="overview-grid">
            <section className="overview-block" aria-labelledby="t-title">
              <div className="block-head"><h2 id="t-title">Open tasks</h2><button type="button" className="link-button" onClick={() => go('tasks')}>All</button></div>
              {tasks.length === 0 ? <p className="muted">No open tasks. Make one from a message in a discussion, or type /task in a document.</p> : taskList(tasks.slice(0, 5))}
            </section>
            <section className="overview-block" aria-labelledby="d-title">
              <div className="block-head"><h2 id="d-title">Recent discussions</h2></div>
              {discussions.length === 0 ? <p className="muted">Nothing discussed yet.</p> : (
                <ul className="recent-discussions">
                  {discussions.map((d) => <li key={d.id}><button type="button" className="link-button" onClick={() => go('discussions', d.id)}>{d.title}</button><span className="muted">{d.posts === 1 ? '1 message' : `${d.posts} messages`} · {timeAgo(d.last_at)}</span></li>)}
                </ul>
              )}
            </section>
            <section className="overview-block" aria-labelledby="dec-title">
              <div className="block-head"><h2 id="dec-title">Latest decisions</h2><button type="button" className="link-button" onClick={() => go('decisions')}>All</button></div>
              {decisions.length === 0 ? <p className="muted">No decisions yet. Answer a question, or type /decision in a document.</p> : decisionList(inForce.slice(0, 3))}
            </section>
            <section className="overview-block" aria-labelledby="doc-title">
              <div className="block-head"><h2 id="doc-title">Documents</h2><button type="button" className="link-button" onClick={() => go('documents')}>All</button></div>
              {documents.length === 0 ? <p className="muted">No documents yet.</p> : (
                <ul className="recent-discussions">{documents.slice(0, 4).map((d) => <li key={d.id}><Link to={`/doc/${d.id}`}>{d.title}</Link><span className="muted">{timeAgo(d.updated_at)}</span></li>)}</ul>
              )}
            </section>
          </div>
          <Activity events={events} filtered />
        </div>
      )}

      {tab === 'ideas' && (mounted
        ? <Suspense fallback={<p className="muted">Loading ideas…</p>}><Board documentId={space.id} room={`space/${space.id}`} space user={me} canEdit={atLeast(role, 'commenter')} canMakeDoc={atLeast(role, 'editor')} people={people} /></Suspense>
        : <p className="muted">Loading ideas…</p>)}

      {tab === 'discussions' && (mounted
        ? <Suspense fallback={<p className="muted">Loading discussions…</p>}><SpaceRoom spaceId={space.id} user={me} canWrite={atLeast(role, 'commenter')} nib={nib} people={people} open={params.get('d')} onOpen={(d) => go('discussions', d)} /></Suspense>
        : <p className="muted">Loading discussions…</p>)}

      {tab === 'documents' && (documents.length === 0 ? (
        <section className="empty">
          <h2>Nothing in this space yet</h2>
          <p className="muted">Documents made here are shared with every member of the space.</p>
        </section>
      ) : <div className="cards">{documents.map((d, i) => <DocCard key={d.id} doc={d} owner={owner} index={i} />)}</div>)}

      {tab === 'decisions' && (decisions.length === 0
        ? <p className="muted">No decisions yet. Answer a question in Discussions, or type /decision in a document in this space; each gets the next number here.</p>
        : (
          <section className="decision-log" aria-label="Decisions">
            <div className="room-bar">
              <div className="segmented" role="group" aria-label="Which decisions">
                <button type="button" className={allDecisions ? '' : 'on'} aria-pressed={!allDecisions} onClick={() => setAllDecisions(false)}>In force</button>
                <button type="button" className={allDecisions ? 'on' : ''} aria-pressed={allDecisions} onClick={() => setAllDecisions(true)}>All</button>
              </div>
              <span className="muted small">{inForce.length} in force{decisions.length > inForce.length && ` · ${decisions.length - inForce.length} replaced`}</span>
            </div>
            {decisionList(allDecisions ? decisions : inForce)}
          </section>
        ))}

      {tab === 'tasks' && (tasks.length === 0
        ? <p className="muted">No open tasks in this space.</p>
        : <section aria-label="Open tasks">{taskList(tasks)}<p className="muted small"><Link to="/tasks">Tick them on your Tasks page</Link>.</p></section>)}
    </div>
  )
}
