import { env } from 'cloudflare:workers'
import { Link, redirect } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { createInMode, listDocuments, reviewQueue, type Mode } from '~/lib/db.server'
import { createSpace } from '~/lib/access.server'
import { claimGuestDocuments, clearGuestCookie } from '~/lib/guest.server'
import { listInbox, logEvent, logSpaceEvent } from '~/lib/events.server'
import { listTasks } from '~/lib/work.server'
import { statusLabel, type Status } from '~/lib/status'
import { colorFor } from '~/lib/color'
import { timeAgo } from '~/lib/time'
import { Activity } from '~/components/activity'
import { NeedsAttention, day, type Waiting } from '~/components/attention'
import { Avatar } from '~/components/avatar'
import { DocCard } from '~/components/doc-card'
import { Icon } from '~/components/icon'
import { NewMenu } from '~/components/new-menu'
import type { Route } from './+types/home'

export const meta = () => [{ title: 'Home · cowrite' }]

// Someone counts as writing while their last edit is this recent.
const LIVE = 5 * 60e3

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  // Documents made before signing in (without an account) become this account's own, and the
  // person lands on them, instead of on home.
  const saved = await claimGuestDocuments(request, user.id)
  if (saved) throw redirect(`/documents?saved=${saved}`, { headers: { 'Set-Cookie': clearGuestCookie(request) } })

  // Dates are UTC days, like the rest of the app. The week runs Monday to Sunday.
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const monday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7))
  const week = Array.from({ length: 7 }, (_, i) => new Date(monday + i * 864e5).toISOString().slice(0, 10))
  const mySpaces = 'SELECT space_id FROM space_memberships WHERE user_id = ?1'

  const [docs, tasks, events, questions, decided, summaries] = await Promise.all([
    listDocuments(user.id),
    listTasks(user.id),
    listInbox(user.id),
    env.DB.prepare(
      `SELECT d.id, d.title, d.space_id, s.name AS space, d.owner_id, d.due FROM discussions d JOIN spaces s ON s.id = d.space_id
       WHERE d.space_id IN (${mySpaces}) AND d.kind = 'question' AND d.status = 'open' ORDER BY d.due IS NULL, d.due`,
    ).bind(user.id).all<{ id: string; title: string; space_id: string; space: string; owner_id: string | null; due: string | null }>(),
    env.DB.prepare(
      `SELECT id, number, text FROM decisions WHERE status = 'decided' AND decided_at >= ?2
       AND (space_id IN (${mySpaces}) OR (space_id IS NULL AND owner_id = ?1)) ORDER BY decided_at DESC`,
    ).bind(user.id, Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).all<{ id: string; number: number; text: string }>(),
    // Nib's saved summary of each space. Home only reads them; a space page writes them when due.
    env.DB.prepare(`SELECT id, name, state_text AS text, state_at AS at FROM spaces WHERE id IN (${mySpaces}) AND nib = 1 AND state_text != '' ORDER BY state_at DESC LIMIT 3`)
      .bind(user.id).all<{ id: string; name: string; text: string; at: number | null }>(),
  ])
  const review = await reviewQueue(user.id, docs)
  const mine = tasks.filter((t) => t.assignee_id === user.id)
  const late = (due: string | null) => !!due && due < today

  // Everything that waits for this person, from every space. Late things first, then by date.
  const waiting: Waiting[] = [
    ...questions.results.filter((q) => q.owner_id === user.id).map((q): Waiting => ({
      key: `q${q.id}`, verb: 'Decide', title: q.title, who: null, whoId: null, due: q.due, note: q.space, to: `/space/${q.space_id}?tab=discussions&d=${q.id}` })),
    ...review.map((d): Waiting => ({
      key: `r${d.id}`, verb: 'Review', title: d.title, who: null, whoId: null, due: null, note: d.by ? `${d.by} asked ${timeAgo(d.at)}` : d.space ?? undefined, to: `/doc/${d.id}?suggest=1` })),
    ...mine.filter((t) => !t.done).map((t): Waiting => ({
      key: `t${t.id}`, verb: 'Do', title: t.text || 'Untitled task', who: null, whoId: null, due: t.due, note: t.title,
      to: t.discussion_id ? `/space/${t.space_id}?tab=discussions&d=${t.discussion_id}` : `/doc/${t.document_id}` })),
  ].sort((a, b) => Number(late(b.due)) - Number(late(a.due)) || (a.due ?? '9999').localeCompare(b.due ?? '9999'))

  // Who is writing now: other people's edits in the last few minutes, on the most recent document.
  const edits = events.filter((e) => e.type === 'edited' && e.document_id && now.getTime() - e.at < LIVE)
  const live = edits.filter((e, i) => e.document_id === edits[0].document_id && edits.findIndex((x) => x.actor_id === e.actor_id) === i)

  const thisWeek = mine.filter((t) => t.due && t.due >= week[0] && t.due <= week[6])
  const stateOf = (t: { done: number; due: string | null }) => (t.done ? 'done' : late(t.due) ? 'late' : 'coming')
  return {
    firstName: user.name.split(' ')[0],
    owner: { name: user.name, color: user.color, image: user.image },
    me: user.id,
    today,
    recent: docs.slice(0, 3),
    hasDocs: docs.length > 0,
    waiting,
    week: week.map((date) => ({ date, tasks: thisWeek.filter((t) => t.due === date).map(stateOf) })),
    weekCount: { done: thisWeek.filter((t) => t.done).length, late: thisWeek.filter((t) => stateOf(t) === 'late').length, total: thisWeek.length },
    questions: { open: questions.results.length, next: questions.results[0] ?? null },
    decided: { count: decided.results.length, latest: decided.results[0] ?? null },
    stages: (Object.keys(statusLabel) as Status[]).map((status) => ({ status, n: docs.filter((d) => d.status === status).length })),
    live: live.map((e) => ({ id: e.actor_id, name: e.actor, color: colorFor(e.actor_id, e.actor_color), image: e.actor_image, doc: e.document_id!, title: e.title })),
    summaries: summaries.results,
    events,
  }
}

// "New document" from anywhere posts here: create it and open it.
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request)
  const f = await request.formData()
  const intent = f.get('intent')
  if (intent === 'new-space') {
    const name = String(f.get('name') ?? '').trim().slice(0, 60)
    if (!name) return null
    const id = await createSpace(user.id, name)
    await logSpaceEvent(id, user.id, 'space', `created the space “${name}”`)
    throw redirect(`/space/${id}`)
  }
  if (intent !== 'create') return null
  const { id, title } = await createInMode(user.id, String(f.get('mode') ?? 'write') as Mode, null, String(f.get('title') ?? '').trim().slice(0, 120))
  await logEvent(id, user.id, 'created', `created “${title}”`)
  throw redirect(`/doc/${id}`)
}

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const dayOf = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(d + 'T00:00').toLocaleDateString('en', opts)

// A number with its label; a link when there is somewhere to go.
function Tile({ to, label, icon, children }: { to?: string; label: string; icon: Parameters<typeof Icon>[0]['name']; children: React.ReactNode }) {
  const body = <><span className="tile-label">{label}<Icon name={icon} /></span>{children}</>
  return to ? <Link className="tile" to={to}>{body}</Link> : <div className="tile">{body}</div>
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { firstName, owner, me, today, recent, hasDocs, waiting, week, weekCount, questions, decided, stages, live, summaries, events } = loaderData
  const late = waiting.filter((r) => r.due && r.due < today).length
  const verbs = (['Decide', 'Review', 'Do'] as const).map((v) => [v, waiting.filter((r) => r.verb === v).length] as const).filter(([, n]) => n > 0)
  const total = stages.reduce((sum, s) => sum + s.n, 0)
  const names = live.length > 2 ? `${live[0].name}, ${live[1].name} and ${live.length - 2} more` : live.map((p) => p.name).join(' and ')

  if (!hasDocs && waiting.length === 0) return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{greeting()}, {firstName}</h1>
          <p className="muted">Your documents will show up here.</p>
        </div>
      </header>
      <section className="empty">
        <h2>Start your first document</h2>
        <p className="muted">Write alone, or open the same document in two places and watch it stay in sync.</p>
        <NewMenu />
      </section>
    </div>
  )

  return (
    <div className="page dash">
      <header className="dash-head">
        <div>
          <p className="eyebrow">{dayOf(today, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1>{greeting()}, {firstName}</h1>
          <p className="muted">{waiting.length === 0 ? 'Nothing waits for you right now.' : `${plural(waiting.length, 'thing waits', 'things wait')} for you${late ? `, and ${late === 1 ? '1 is' : `${late} are`} late` : ''}.`}</p>
        </div>
        {live.length > 0 && (
          <Link className="dash-live" to={`/doc/${live[0].doc}`}>
            <span className="avatars">{live.slice(0, 3).map((p) => <Avatar key={p.id} name={p.name} color={p.color} image={p.image} size={26} />)}</span>
            <span><strong>{names}</strong> {live.length === 1 ? 'is' : 'are'} writing in <strong>{live[0].title}</strong></span>
          </Link>
        )}
      </header>

      <div className="dash-tiles">
        <Tile to="#attention-title" label="Waiting on you" icon="bell">
          <span className="tile-num">{waiting.length}</span>
          <span className="tile-foot">
            {late > 0 && <span className="tile-late">{late} late</span>}
            {verbs.length ? verbs.map(([v, n]) => `${n} ${v.toLowerCase()}`).join(' · ') : 'All clear'}
          </span>
        </Tile>
        <Tile to="/tasks" label="Your tasks this week" icon="tasks">
          <span className="tile-num">{weekCount.done}<small>of {weekCount.total} done</small></span>
          {weekCount.total > 0
            ? <span className="tile-bar" aria-hidden="true"><i style={{ width: `${(weekCount.done / weekCount.total) * 100}%` }} /></span>
            : <span className="tile-foot">Nothing due this week</span>}
        </Tile>
        <Tile to={questions.next ? `/space/${questions.next.space_id}?tab=discussions&d=${questions.next.id}` : undefined} label="Open questions" icon="comment">
          <span className="tile-num">{questions.open}</span>
          <span className="tile-foot">
            {!questions.next ? 'None open' : !questions.next.due ? 'None has a date' : questions.next.due < today ? <strong className="late">One is late</strong>
              : <>Next is due <strong>{questions.next.due === today ? 'today' : day(questions.next.due)}</strong></>}
          </span>
        </Tile>
        <Tile to={decided.latest ? `/decision/${decided.latest.id}` : undefined} label={`Decided in ${dayOf(today, { month: 'long' })}`} icon="check">
          <span className="tile-num">{decided.count}</span>
          <span className="tile-foot">{decided.latest ? <>Latest: <strong>D-{decided.latest.number}</strong> {decided.latest.text}</> : 'Nothing yet'}</span>
        </Tile>
      </div>

      <div className="dash-grid">
        <div className="dash-main">
          <NeedsAttention rows={waiting} me={me} filtered />
          {recent.length > 0 && (
            <section aria-labelledby="recent-title">
              <div className="section-head"><h2 id="recent-title">Pick up where you left off</h2><Link to="/documents">All documents</Link></div>
              <div className="cards">{recent.map((d, i) => <DocCard key={d.id} doc={d} owner={owner} index={i} />)}</div>
            </section>
          )}
          <Activity events={events} limit={5} title="Latest in your spaces" />
        </div>

        <aside className="dash-side">
          {summaries.length > 0 && (
            <section className="nib-card" aria-labelledby="nib-title">
              <div className="block-head"><h2 id="nib-title"><span className="ai-mark" aria-hidden="true">✦</span> This week in your spaces</h2></div>
              {summaries.map((s) => (
                <div key={s.id} className="dash-summary">
                  <p className="dash-summary-head"><Link to={`/space/${s.id}`}>{s.name}</Link>{s.at && <span className="muted small">{timeAgo(s.at)}</span>}</p>
                  <p className="week-text">{s.text}</p>
                </div>
              ))}
            </section>
          )}

          <section className="dash-sheet" aria-labelledby="week-title">
            <div className="block-head"><h2 id="week-title">This week</h2><span className="muted small">{plural(weekCount.total, 'task', 'tasks')} for you</span></div>
            <ol className="week-strip">
              {week.map((d) => (
                <li key={d.date} data-today={d.date === today || undefined} data-past={d.date < today || undefined}>
                  <span>{dayOf(d.date, { weekday: 'short' })}</span>
                  <strong>{Number(d.date.slice(8))}</strong>
                  <span className="week-dots" aria-hidden="true">{d.tasks.slice(0, 4).map((s, i) => <i key={i} data-state={s} />)}</span>
                  {d.tasks.length > 0 && <span className="sr-only">{plural(d.tasks.length, 'task', 'tasks')}</span>}
                </li>
              ))}
            </ol>
            <p className="week-legend">
              <span><i data-state="done" />Done {weekCount.done}</span>
              <span><i data-state="late" />Late {weekCount.late}</span>
              <span><i data-state="coming" />Coming {weekCount.total - weekCount.done - weekCount.late}</span>
            </p>
            <Link to="/tasks" className="small">Open Tasks</Link>
          </section>

          <section className="dash-sheet" aria-labelledby="stage-title">
            <div className="block-head"><h2 id="stage-title">Your documents</h2><span className="muted small"><strong>{total}</strong> in total</span></div>
            <div className="stage-bar" role="img" aria-label={stages.map((s) => `${s.n} ${statusLabel[s.status].toLowerCase()}`).join(', ')}>
              {stages.filter((s) => s.n > 0).map((s) => <i key={s.status} data-status={s.status} style={{ flexGrow: s.n }} />)}
            </div>
            <ul className="stage-list">
              {stages.map((s) => <li key={s.status}><i data-status={s.status} />{statusLabel[s.status]}<strong>{s.n}</strong></li>)}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}
