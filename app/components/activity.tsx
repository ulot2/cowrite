import { useState } from 'react'
import { Link } from 'react-router'
import type { EventRow } from '~/lib/events.server'
import { colorFor } from '~/lib/color'
import { timeAgo } from '~/lib/time'
import { Avatar } from './avatar'
import { Icon } from './icon'

// The small badge on an avatar says what kind of thing happened.
const kinds: Record<string, string> = {
  commented: 'comment', mention: 'comment', created: 'plus', deleted: 'trash', edited: 'suggest', renamed: 'suggest',
  suggestion: 'suggest', joined: 'user', moved: 'space', space: 'space', published: 'globe', restored: 'history',
  version: 'history', shared: 'share', status: 'check', task: 'tasks', discussion: 'comment', decision: 'check',
  signoff: 'check', check: 'sparkle', idea: 'board',
}
export function EventAvatar({ e, size = 28 }: { e: EventRow; size?: number }) {
  return (
    <span className="event-avatar">
      {e.actor_id === 'ai'
        ? <span className="avatar nib-avatar" style={{ width: size, height: size, fontSize: size * 0.45 }} title="Nib"><span aria-hidden="true">✦</span><span className="sr-only">Nib</span></span>
        : <Avatar name={e.actor} color={colorFor(e.actor_id, e.actor_color)} image={e.actor_image} size={size} />}
      <span className="event-kind" data-type={e.type} aria-hidden="true"><Icon name={kinds[e.type] ?? 'docs'} /></span>
    </span>
  )
}

// "Today", "Yesterday", else the date. Days are split in the reader's time zone after hydration;
// the server splits in UTC, so a row near midnight can move group on hydration. (ponytail)
const dayOf = (ms: number) => {
  const d = new Date(ms), today = new Date()
  const days = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5)
  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString('en', { month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

// What a row's link points at, as its chip says it.
const linkLabel = (link: string) => (link.startsWith('/decision/') ? ['check', 'Decision'] : link.includes('tab=ideas') ? ['board', 'Ideas board'] : ['comment', 'Discussion']) as ['check' | 'board' | 'comment', string]

// The space timeline's filters. Each is a set of event types.
const filters = [
  ['all', 'All', []],
  ['decisions', 'Decisions', ['decision']],
  ['discussions', 'Discussions', ['discussion', 'commented', 'mention']],
  ['documents', 'Documents', ['created', 'edited', 'renamed', 'moved', 'deleted', 'version', 'restored', 'published']],
  ['review', 'Review', ['status', 'signoff', 'check', 'suggestion']],
] as const

// The timeline. `here` is the document the page is about, so its own rows do not link back to it.
// `limit` shows only the newest rows until "Show all activity"; `filtered` adds the filter chips
// to the full timeline (the space page).
export function Activity({ events: all, here, filtered = false, limit, title = 'Activity' }: { events: EventRow[]; here?: string; filtered?: boolean; limit?: number; title?: string }) {
  const [filter, setFilter] = useState<(typeof filters)[number][0]>('all')
  const [open, setOpen] = useState(!limit)
  if (all.length === 0) return null
  const types = filters.find(([k]) => k === filter)![2] as readonly string[]
  const kept = filter === 'all' || !open ? all : all.filter((e) => types.includes(e.type))
  const events = open ? kept : kept.slice(0, limit)
  const days = new Map<string, EventRow[]>()
  for (const e of events) { const day = dayOf(e.at); days.set(day, [...(days.get(day) ?? []), e]) }
  return (
    <section className="activity" aria-labelledby="activity-title">
      <div className="activity-head">
        <h2 id="activity-title">{title}</h2>
        {open && <span className="muted">{events.length === 1 ? '1 update' : `${events.length} updates`}</span>}
        {limit && all.length > limit && <button type="button" className="link-button activity-toggle" aria-expanded={open} onClick={() => { setOpen(!open); setFilter('all') }}>{open ? 'Show less' : 'Show all activity'}</button>}
      </div>
      {filtered && open && (
        <div className="activity-filters" role="group" aria-label="Show">
          {filters.map(([k, label]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>)}
        </div>
      )}
      {events.length === 0 && <p className="muted small">Nothing of this kind yet.</p>}
      {[...days].map(([day, rows]) => (
        <div key={day} className="activity-day">
          <h3>{day}</h3>
          <ol>
            {rows.map((e) => (
              <li key={e.id}>
                <EventAvatar e={e} />
                <div className="activity-body">
                  <p><strong>{e.actor}</strong> {e.text}</p>
                  {((e.title && e.document_id && e.document_id !== here) || e.link) && (
                    <span className="event-links">
                      {e.title && e.document_id && e.document_id !== here && <Link className="event-doc" to={`/doc/${e.document_id}`}><Icon name="docs" />{e.title}</Link>}
                      {e.link && (() => { const [icon, label] = linkLabel(e.link); return <Link className="event-doc" to={e.link}><Icon name={icon} />{label}</Link> })()}
                    </span>
                  )}
                </div>
                <time dateTime={new Date(e.at).toISOString()}>{timeAgo(e.at)}</time>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  )
}
