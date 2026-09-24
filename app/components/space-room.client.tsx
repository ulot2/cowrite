import { useEffect, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { timeAgo } from '~/lib/time'
import { Avatar } from './avatar'
import { Icon } from './icon'
import { Select } from './select'

export type Member = { id: string; name: string; color: string; image?: string | null }
type Post = { id: string; userId: string; text: string; createdAt: number; taskId?: string }
type Task = { text: string; assignee: string; assigneeName: string; due: string; done: boolean; discussionId: string; postId: string; createdBy: string }
type Discussion = {
  id: string; title: string; kind: 'talk' | 'question'; status: 'open' | 'answered' | 'closed'
  owner: string; due: string; answer: string; answeredBy: string; createdBy: string; createdAt: number; posts: Post[]; lastAt: number; decisionNumber: number; idea: string
}

type Props = {
  spaceId: string
  user: { id: string; name: string }
  canWrite: boolean // commenters and up; viewers read
  nib?: boolean // Nib is on in this person's settings
  people: Member[]
  open: string | null // the thread in the URL
  onOpen: (id: string | null) => void
}

const today = () => new Date().toISOString().slice(0, 10)
const day = (d: string) => new Date(d + 'T00:00').toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })

// The space's room: discussions and the tasks made from their posts. Same object and protocol as a
// document's rooms, so it is live, works offline, and merges. The room's alarm indexes it into D1.
export function SpaceRoom({ spaceId, user, canWrite, nib = false, people, open, onOpen }: Props) {
  const [sync] = useState(() => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/space`
    const doc = new Y.Doc()
    const provider = new WebsocketProvider(url, spaceId, doc, { disableBc: true, connect: false })
    return { doc, provider, discussions: doc.getMap<Y.Map<unknown>>('discussions'), tasks: doc.getMap<Task>('tasks') }
  })
  const [list, setList] = useState<Discussion[]>([])
  const [tasks, setTasks] = useState<Record<string, Task>>({})
  const [synced, setSynced] = useState(false)

  // Connect on mount, read on every change, free everything a tick after unmount (see board.client).
  const destroyTimer = useRef<number>(undefined)
  useEffect(() => {
    clearTimeout(destroyTimer.current)
    const { doc, provider, discussions, tasks } = sync
    provider.connect()
    const read = () => {
      setList([...discussions.entries()].map(([id, d]) => {
        const posts = ((d.get('posts') as Y.Array<Y.Map<unknown>> | undefined)?.toArray() ?? []).map((p) => ({
          id: String(p.get('id')), userId: String(p.get('userId')), text: String(p.get('text') ?? ''), createdAt: Number(p.get('createdAt') ?? 0), taskId: p.get('taskId') as string | undefined,
        }))
        const createdAt = Number(d.get('createdAt') ?? 0)
        return {
          id, title: String(d.get('title') ?? ''), kind: d.get('kind') === 'question' ? 'question' : 'talk', status: (d.get('status') as Discussion['status']) ?? 'open',
          owner: String(d.get('owner') ?? ''), due: String(d.get('due') ?? ''), answer: String(d.get('answer') ?? ''), answeredBy: String(d.get('answeredBy') ?? ''),
          createdBy: String(d.get('createdBy') ?? ''), createdAt, posts, lastAt: posts.at(-1)?.createdAt ?? createdAt, decisionNumber: Number(d.get('decisionNumber') ?? 0), idea: String(d.get('idea') ?? ''),
        } satisfies Discussion
      }).sort((a, b) => b.lastAt - a.lastAt))
      setTasks(Object.fromEntries(tasks.entries()))
    }
    const onSync = (s: boolean) => { if (s) setSynced(true) }
    discussions.observeDeep(read); tasks.observe(read); provider.on('sync', onSync)
    read()
    return () => {
      discussions.unobserveDeep(read); tasks.unobserve(read); provider.off('sync', onSync)
      provider.disconnect()
      destroyTimer.current = window.setTimeout(() => { provider.destroy(); doc.destroy() }, 0)
    }
  }, [sync])

  const person = (id: string) => people.find((p) => p.id === id) ?? { id, name: id === user.id ? user.name : id === 'ai' ? 'Nib' : 'Someone', color: id === 'ai' ? 'var(--accent)' : 'var(--fg-muted)' }
  const map = (id: string) => sync.discussions.get(id)!
  const post = (text: string): Y.Map<unknown> => {
    const p = new Y.Map<unknown>()
    p.set('id', crypto.randomUUID()); p.set('userId', user.id); p.set('text', text); p.set('createdAt', Date.now())
    return p
  }

  const start = (f: { title: string; text: string; question: boolean; owner: string; due: string }) => {
    const id = crypto.randomUUID()
    const d = new Y.Map<unknown>()
    const posts = new Y.Array<Y.Map<unknown>>()
    sync.doc.transact(() => {
      sync.discussions.set(id, d)
      d.set('title', f.title); d.set('kind', f.question ? 'question' : 'talk'); d.set('status', 'open')
      d.set('createdBy', user.id); d.set('createdAt', Date.now())
      if (f.question) { d.set('owner', f.owner); d.set('due', f.due) }
      d.set('posts', posts)
      if (f.text) posts.push([post(f.text)])
    })
    onOpen(id)
  }
  const reply = (id: string, text: string) => (map(id).get('posts') as Y.Array<Y.Map<unknown>>).push([post(text)])
  const setField = (id: string, patch: Record<string, unknown>) => sync.doc.transact(() => { for (const [k, v] of Object.entries(patch)) map(id).set(k, v) })
  const makeTask = (d: Discussion, p: Post, t: { text: string; assignee: string; due: string }) => {
    const taskId = crypto.randomUUID()
    const posts = map(d.id).get('posts') as Y.Array<Y.Map<unknown>>
    const target = posts.toArray().find((x) => x.get('id') === p.id)
    sync.doc.transact(() => {
      sync.tasks.set(taskId, { text: t.text, assignee: t.assignee, assigneeName: t.assignee ? person(t.assignee).name : '', due: t.due, done: false, discussionId: d.id, postId: p.id, createdBy: user.id })
      target?.set('taskId', taskId)
    })
  }
  // An accepted proposal from Nib: a message by Nib with the task on it, in one change. The task is
  // created by the person who accepted it, so the bell says who assigned it.
  const acceptTask = (d: Discussion, t: { text: string; assignee: string; due: string }) => {
    const taskId = crypto.randomUUID()
    const p = post(`Next step: ${t.text}`)
    p.set('userId', 'ai')
    sync.doc.transact(() => {
      (map(d.id).get('posts') as Y.Array<Y.Map<unknown>>).push([p])
      p.set('taskId', taskId)
      sync.tasks.set(taskId, { text: t.text, assignee: t.assignee, assigneeName: t.assignee ? person(t.assignee).name : '', due: t.due, done: false, discussionId: d.id, postId: String(p.get('id')), createdBy: user.id })
    })
  }
  // An accepted decision answers the discussion (a plain talk becomes a question first); the room's
  // alarm then records it as the next D-number.
  const acceptDecision = (d: Discussion, outcome: string) => setField(d.id, { kind: 'question', status: 'answered', answer: outcome, answeredBy: user.id })
  const tick = (taskId: string) => { const t = sync.tasks.get(taskId); if (t) sync.tasks.set(taskId, { ...t, done: !t.done }) }

  const current = open ? list.find((d) => d.id === open) : null
  if (open && !current) return <p className="muted room-wait">{synced ? 'This discussion is gone.' : 'Loading the discussion…'} <button type="button" className="link-button" onClick={() => onOpen(null)}>All discussions</button></p>
  if (current) return <Thread d={current} tasks={tasks} canWrite={canWrite} nib={nib} people={people} person={person} user={user}
    onAcceptTask={(t) => acceptTask(current, t)} onAcceptDecision={(o) => acceptDecision(current, o)}
    onBack={() => onOpen(null)} onReply={(t) => reply(current.id, t)} onSet={(patch) => setField(current.id, patch)} onTask={(p, t) => makeTask(current, p, t)} onTick={tick} />
  return <DiscussionList list={list} synced={synced} canWrite={canWrite} people={people} person={person} user={user} onOpen={onOpen} onStart={start} />
}

type PersonOf = (id: string) => Member

function QuestionBadge({ d, person }: { d: Discussion; person: PersonOf }) {
  if (d.kind !== 'question') return d.status === 'closed' ? <span className="pill">Closed</span> : null
  if (d.status === 'answered') return <span className="pill ok-pill"><Icon name="check" />{d.decisionNumber ? `Decided · D-${d.decisionNumber}` : 'Answered'}</span>
  if (d.status === 'closed') return <span className="pill">Closed</span>
  const late = d.due && d.due < today()
  return (
    <span className="question-badge" data-late={late || undefined}>
      <span className="q-mark" aria-hidden="true">?</span>
      Question{d.owner && <> · <Avatar name={person(d.owner).name} color={person(d.owner).color} image={person(d.owner).image} size={16} />{person(d.owner).name.split(' ')[0]}</>}
      {d.due && <> · {late ? 'was due' : 'decide by'} {day(d.due)}</>}
    </span>
  )
}

function DiscussionList({ list, synced, canWrite, people, person, user, onOpen, onStart }: {
  list: Discussion[]; synced: boolean; canWrite: boolean; people: Member[]; person: PersonOf; user: { id: string }
  onOpen: (id: string) => void; onStart: (f: { title: string; text: string; question: boolean; owner: string; due: string }) => void
}) {
  const [writing, setWriting] = useState(false)
  const [question, setQuestion] = useState(false)
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const shown = list.filter((d) => filter === 'all' || d.status === 'open')
  return (
    <div className="room">
      <div className="room-bar">
        <div className="segmented" role="group" aria-label="Which discussions">
          <button type="button" className={filter === 'open' ? 'on' : ''} aria-pressed={filter === 'open'} onClick={() => setFilter('open')}>Open</button>
          <button type="button" className={filter === 'all' ? 'on' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
        </div>
        {canWrite && !writing && <button type="button" className="primary" onClick={() => setWriting(true)}><Icon name="plus" />New discussion</button>}
      </div>

      {writing && (
        <form className="new-discussion" onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          onStart({ title: String(f.get('title')).trim(), text: String(f.get('text') ?? '').trim(), question, owner: String(f.get('owner') ?? ''), due: String(f.get('due') ?? '') })
          setWriting(false); setQuestion(false)
        }}>
          <input name="title" required maxLength={200} placeholder="What do you want to talk about?" aria-label="Title" autoFocus />
          <textarea name="text" rows={3} maxLength={5000} placeholder="Add the details, or the options you see" aria-label="First message" />
          <label className="check"><input type="checkbox" role="switch" className="switch" checked={question} onChange={(e) => setQuestion(e.target.checked)} />This needs a decision</label>
          {question && (
            <div className="question-fields">
              <label>Who decides<Select name="owner" label="Who decides" defaultValue={user.id} options={people.map((p) => ({ value: p.id, label: p.name }))} /></label>
              <label>Decide by<input type="date" name="due" min={today()} /></label>
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="ghost" onClick={() => { setWriting(false); setQuestion(false) }}>Cancel</button>
            <button className="primary">{question ? 'Ask the question' : 'Start the discussion'}</button>
          </div>
        </form>
      )}

      {!synced && list.length === 0 ? <p className="muted room-wait">Loading discussions…</p> : shown.length === 0 ? (
        <div className="room-empty">
          <span className="room-empty-icon" aria-hidden="true"><Icon name="comment" /></span>
          <strong>{filter === 'open' && list.length ? 'No open discussions' : 'No discussions yet'}</strong>
          <span className="muted">Talk about the work here, not only about a sentence. Ask a question with a deadline when something needs deciding.</span>
        </div>
      ) : (
        <ul className="discussion-list">
          {shown.map((d) => {
            const last = d.posts.at(-1)
            return (
              <li key={d.id}>
                <button type="button" onClick={() => onOpen(d.id)} data-status={d.status}>
                  <span className="discussion-main">
                    <strong>{d.title || 'Untitled'}</strong>
                    <span className="discussion-meta"><QuestionBadge d={d} person={person} />{last && <span className="muted">{person(last.userId).name.split(' ')[0]}: {last.text.slice(0, 90)}</span>}</span>
                  </span>
                  <span className="discussion-side">
                    <span className="avatars">{[...new Set(d.posts.map((p) => p.userId))].slice(0, 3).map((id) => <Avatar key={id} name={person(id).name} color={person(id).color} image={person(id).image} size={22} />)}</span>
                    <span className="muted">{d.posts.length === 1 ? '1 message' : `${d.posts.length} messages`} · {timeAgo(d.lastAt)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Thread({ d, tasks, canWrite, nib, people, person, user, onBack, onReply, onSet, onTask, onTick, onAcceptTask, onAcceptDecision }: {
  d: Discussion; tasks: Record<string, Task>; canWrite: boolean; nib: boolean; people: Member[]; person: PersonOf; user: { id: string }
  onBack: () => void; onReply: (text: string) => void; onSet: (patch: Record<string, unknown>) => void
  onTask: (p: Post, t: { text: string; assignee: string; due: string }) => void; onTick: (taskId: string) => void
  onAcceptTask: (t: { text: string; assignee: string; due: string }) => void; onAcceptDecision: (outcome: string) => void
}) {
  const [answering, setAnswering] = useState(false)
  const [tasking, setTasking] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [d.posts.length])
  const owner = d.owner ? person(d.owner) : null
  return (
    <div className="room thread">
      <button type="button" className="ghost back" onClick={onBack}><Icon name="collapse" />All discussions</button>
      <header className="thread-head">
        <h2>{d.title || 'Untitled'}</h2>
        <p className="muted">Started by {person(d.createdBy).name} · {timeAgo(d.createdAt)}{d.idea && <> · <a href="?tab=ideas">From an idea</a></>}</p>
      </header>

      {d.kind === 'question' && (
        <section className="question-card" data-status={d.status} data-late={(d.status === 'open' && d.due && d.due < today()) || undefined} aria-label="The question">
          <div className="question-facts">
            <span><span className="muted">Who decides</span>{owner ? <><Avatar name={owner.name} color={owner.color} image={owner.image} size={20} />{owner.name}</> : 'Nobody yet'}</span>
            <span><span className="muted">Decide by</span>{d.due ? day(d.due) : 'No date'}</span>
            <span><span className="muted">Status</span>{d.status === 'answered' ? 'Answered' : d.status === 'closed' ? 'Closed' : d.due && d.due < today() ? 'Overdue' : 'Waiting for a decision'}</span>
          </div>
          {d.status === 'answered' && <blockquote className="answer"><strong>Answer</strong>{d.answer}<small>{person(d.answeredBy).name}{d.decisionNumber > 0 && <> · <a href={`/decision/q:${d.id}`}>Recorded as D-{d.decisionNumber} →</a></>}{d.decisionNumber === 0 && ' · becoming a decision…'}</small></blockquote>}
          {canWrite && d.status === 'open' && (answering ? (
            <form className="answer-form" onSubmit={(e) => { e.preventDefault(); const a = String(new FormData(e.currentTarget).get('answer')).trim(); if (a) { onSet({ status: 'answered', answer: a, answeredBy: user.id }); setAnswering(false) } }}>
              <textarea name="answer" rows={2} required maxLength={1000} placeholder="What was decided?" aria-label="The answer" autoFocus />
              <div className="form-actions"><button type="button" className="ghost" onClick={() => setAnswering(false)}>Cancel</button><button className="primary">Save the answer</button></div>
            </form>
          ) : <button type="button" className="primary" onClick={() => setAnswering(true)}><Icon name="check" />Mark answered</button>)}
        </section>
      )}

      {canWrite && nib && d.posts.length > 0 && <NextSteps d={d} people={people} onAcceptTask={onAcceptTask} onAcceptDecision={onAcceptDecision} />}

      <ol className="posts">
        {d.posts.map((p) => {
          const who = person(p.userId)
          const task = p.taskId ? tasks[p.taskId] : undefined
          return (
            <li key={p.id} className="post">
              <Avatar name={who.name} color={who.color} image={who.image} size={32} />
              <div className="post-body">
                <p className="post-head"><strong>{who.name}</strong><time className="muted">{timeAgo(p.createdAt)}</time></p>
                <p className="post-text">{p.text}</p>
                {task ? (
                  <div className="post-task" data-done={task.done || undefined}>
                    <button type="button" className="task-tick" aria-pressed={task.done} disabled={!canWrite && task.assignee !== user.id} aria-label={task.done ? 'Mark as not done' : 'Mark as done'} onClick={() => onTick(p.taskId!)}>
                      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
                    </button>
                    <span className="post-task-text">{task.text}</span>
                    {task.assignee && <span className="chip person-chip"><Avatar name={person(task.assignee).name} color={person(task.assignee).color} image={person(task.assignee).image} size={18} />{person(task.assignee).name.split(' ')[0]}</span>}
                    {task.due && <span className="chip">{day(task.due)}</span>}
                  </div>
                ) : canWrite && (tasking === p.id ? (
                  <form className="task-form" onSubmit={(e) => {
                    e.preventDefault()
                    const f = new FormData(e.currentTarget)
                    onTask(p, { text: String(f.get('text')).trim(), assignee: String(f.get('assignee') ?? ''), due: String(f.get('due') ?? '') })
                    setTasking(null)
                  }}>
                    <input name="text" required maxLength={300} defaultValue={p.text.split('\n')[0].slice(0, 120)} aria-label="The task" autoFocus />
                    <Select name="assignee" label="Assigned to" defaultValue="" options={[{ value: '', label: 'Nobody yet' }, ...people.map((m) => ({ value: m.id, label: m.name }))]} />
                    <input type="date" name="due" aria-label="Due date" />
                    <button type="button" className="ghost" onClick={() => setTasking(null)}>Cancel</button>
                    <button className="primary">Add task</button>
                  </form>
                ) : <button type="button" className="ghost post-action" onClick={() => setTasking(p.id)}><Icon name="tasks" />Make a task</button>)}
              </div>
            </li>
          )
        })}
        <div ref={end} />
      </ol>

      {canWrite ? (
        <form className="composer" onSubmit={(e) => {
          e.preventDefault()
          const field = e.currentTarget.elements.namedItem('text') as HTMLTextAreaElement
          const text = field.value.trim()
          if (text) { onReply(text); field.value = '' }
        }}>
          <textarea name="text" rows={2} maxLength={5000} placeholder="Write a reply" aria-label="Reply"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} />
          <div className="composer-actions">
            {d.status === 'open'
              ? <button type="button" className="ghost" onClick={() => onSet({ status: 'closed' })}>Close discussion</button>
              : <button type="button" className="ghost" onClick={() => onSet({ status: 'open' })}>Reopen</button>}
            <button className="primary">Reply</button>
          </div>
        </form>
      ) : <p className="muted">You can read this discussion. Ask the space owner for commenter access to reply.</p>}
    </div>
  )
}

type Proposal = { tasks: { text: string; assignee: string; due: string }[]; decision: string | null }

// "Suggest next steps": Nib reads the thread and proposes tasks and a decision. Each is a card that
// can be edited, then added or dismissed. Nothing is created until someone adds it.
function NextSteps({ d, people, onAcceptTask, onAcceptDecision }: {
  d: Discussion; people: Member[]
  onAcceptTask: (t: { text: string; assignee: string; due: string }) => void; onAcceptDecision: (outcome: string) => void
}) {
  const fetcher = useFetcher<{ discussion?: string; proposal?: Proposal; error?: string }>()
  const [closed, setClosed] = useState<Set<string>>(new Set()) // cards added or dismissed: "t0", "decision"
  const busy = fetcher.state !== 'idle'
  const proposal = fetcher.data?.discussion === d.id ? fetcher.data.proposal : undefined
  const close = (key: string) => setClosed((c) => new Set(c).add(key))
  const open = proposal && [...proposal.tasks.map((_, i) => `t${i}`), ...(proposal.decision && d.status === 'open' ? ['decision'] : [])].filter((k) => !closed.has(k))
  return (
    <section className="next-steps" aria-label="Next steps from Nib">
      <div className="next-steps-head">
        <button type="button" className="ghost nib-button" disabled={busy} aria-busy={busy}
          onClick={() => { setClosed(new Set()); fetcher.submit({ intent: 'propose', discussion: d.id }, { method: 'post' }) }}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <span className="ai-mark" aria-hidden="true">✦</span>}
          {busy ? 'Nib is reading the thread…' : proposal ? 'Suggest again' : 'Suggest next steps'}
        </button>
        {proposal && open && open.length > 0 && <button type="button" className="link-button" onClick={() => open.forEach(close)}>Dismiss all</button>}
      </div>
      {!busy && fetcher.data?.error && <p className="error small" role="alert">{fetcher.data.error}</p>}
      {!busy && proposal && open?.length === 0 && <p className="muted small" role="status">{proposal.tasks.length || proposal.decision ? 'All done. Added items are in the thread below.' : 'Nib found no next steps in this discussion.'}</p>}
      {!busy && proposal && (
        <ul className="proposals">
          {proposal.tasks.map((t, i) => !closed.has(`t${i}`) && (
            <li key={i}>
              <form className="proposal" onSubmit={(e) => {
                e.preventDefault()
                const f = new FormData(e.currentTarget)
                const text = String(f.get('text') ?? '').trim()
                if (!text) return
                onAcceptTask({ text, assignee: String(f.get('assignee') ?? ''), due: String(f.get('due') ?? '') })
                close(`t${i}`)
              }}>
                <span className="proposal-kind"><Icon name="tasks" />Task</span>
                <input name="text" required maxLength={300} defaultValue={t.text} aria-label="The task" />
                <Select name="assignee" label="Assigned to" defaultValue={t.assignee} options={[{ value: '', label: 'Nobody yet' }, ...people.map((m) => ({ value: m.id, label: m.name }))]} />
                <input type="date" name="due" defaultValue={t.due} aria-label="Due date" />
                <span className="proposal-actions">
                  <button type="button" className="ghost" onClick={() => close(`t${i}`)}>Dismiss</button>
                  <button className="primary">Add task</button>
                </span>
              </form>
            </li>
          ))}
          {proposal.decision && d.status === 'open' && !closed.has('decision') && (
            <li>
              <form className="proposal decision-proposal" onSubmit={(e) => {
                e.preventDefault()
                const outcome = String(new FormData(e.currentTarget).get('outcome') ?? '').trim()
                if (!outcome) return
                onAcceptDecision(outcome)
                close('decision')
              }}>
                <span className="proposal-kind"><Icon name="check" />Decision</span>
                <textarea name="outcome" rows={2} required maxLength={1000} defaultValue={proposal.decision} aria-label="What was decided" />
                <span className="proposal-actions">
                  <button type="button" className="ghost" onClick={() => close('decision')}>Dismiss</button>
                  <button className="primary">Record decision</button>
                </span>
              </form>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}
