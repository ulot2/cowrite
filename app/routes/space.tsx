import { lazy, Suspense, useEffect, useState } from 'react'
import { Form, Link, redirect, useSearchParams } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { createInMode, listSpaceDocuments, type Mode } from '~/lib/db.server'
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

export const meta = ({ loaderData }: Route.MetaArgs) => [{ title: `${loaderData?.space.name ?? 'Space'} · cowrite` }]

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const role = await roleOnSpace(user.id, params.id)
  const space = role && await getSpace(params.id)
  if (!role || !space) throw new Response('Not found', { status: 404 })
  const isOwner = role === 'owner'
  return {
    owner: { name: user.name, color: user.color, image: user.image },
    me: { id: user.id, name: user.name },
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
  if (intent === 'create') {
    if (role !== 'owner' && role !== 'editor') throw new Response('Editors can add documents', { status: 403 })
    const { id, title } = await createInMode(user.id, String(f.get('mode') ?? 'write') as Mode, params.id)
    await logEvent(id, user.id, 'created', `created “${title}”`)
    throw redirect(`/doc/${id}`)
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

const tabs = [['overview', 'Overview'], ['discussions', 'Discussions'], ['documents', 'Documents'], ['decisions', 'Decisions'], ['tasks', 'Tasks']] as const
type Tab = (typeof tabs)[number][0]
const day = (d: string) => new Date(d + 'T00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })
const today = () => new Date().toISOString().slice(0, 10)

export default function Space({ loaderData }: Route.ComponentProps) {
  const { owner, me, space, role, isOwner, documents, members, link, events, decisions, questions, discussions, tasks } = loaderData
  const [params, setParams] = useSearchParams()
  const tab = (tabs.some(([t]) => t === params.get('tab')) ? params.get('tab') : 'overview') as Tab
  const go = (t: Tab, d?: string | null) => setParams(d ? { tab: t, d } : t === 'overview' ? {} : { tab: t }, { preventScrollReset: true })
  const people = members.map((m) => ({ id: m.user_id, name: m.name, color: colorFor(m.user_id, m.color), image: m.image }))
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const count: Partial<Record<Tab, number>> = { discussions: questions.length, documents: documents.length, decisions: decisions.length, tasks: tasks.length }

  const decisionList = (list: typeof decisions) => (
    <ol className="decision-rows">
      {list.map((d) => (
        <li key={d.id} data-status={d.status}>
          <span className="decision-number">{`D-${d.number}`}</span>
          <span className="decision-log-text">{d.text || 'Untitled decision'} <Link to={`/doc/${d.document_id}`}>{d.title}</Link></span>
          <span className="status" data-status={d.status === 'decided' ? 'approved' : d.status === 'dropped' ? 'draft' : 'review'}>{d.status[0].toUpperCase() + d.status.slice(1)}</span>
        </li>
      ))}
    </ol>
  )
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
              {decisions.length === 0 ? <p className="muted">No decisions yet. Type /decision in a document to record one.</p> : decisionList(decisions.slice(0, 3))}
            </section>
            <section className="overview-block" aria-labelledby="doc-title">
              <div className="block-head"><h2 id="doc-title">Documents</h2><button type="button" className="link-button" onClick={() => go('documents')}>All</button></div>
              {documents.length === 0 ? <p className="muted">No documents yet.</p> : (
                <ul className="recent-discussions">{documents.slice(0, 4).map((d) => <li key={d.id}><Link to={`/doc/${d.id}`}>{d.title}</Link><span className="muted">{timeAgo(d.updated_at)}</span></li>)}</ul>
              )}
            </section>
          </div>
          <Activity events={events} />
        </div>
      )}

      {tab === 'discussions' && (mounted
        ? <Suspense fallback={<p className="muted">Loading discussions…</p>}><SpaceRoom spaceId={space.id} user={me} canWrite={atLeast(role, 'commenter')} people={people} open={params.get('d')} onOpen={(d) => go('discussions', d)} /></Suspense>
        : <p className="muted">Loading discussions…</p>)}

      {tab === 'documents' && (documents.length === 0 ? (
        <section className="empty">
          <h2>Nothing in this space yet</h2>
          <p className="muted">Documents made here are shared with every member of the space.</p>
        </section>
      ) : <div className="cards">{documents.map((d, i) => <DocCard key={d.id} doc={d} owner={owner} index={i} />)}</div>)}

      {tab === 'decisions' && (decisions.length === 0
        ? <p className="muted">No decisions yet. Type /decision in a document in this space to record one; it gets the next number here.</p>
        : <section className="decision-log" aria-label="Decisions">{decisionList(decisions)}</section>)}

      {tab === 'tasks' && (tasks.length === 0
        ? <p className="muted">No open tasks in this space.</p>
        : <section aria-label="Open tasks">{taskList(tasks)}<p className="muted small"><Link to="/tasks">Tick them on your Tasks page</Link>.</p></section>)}
    </div>
  )
}
