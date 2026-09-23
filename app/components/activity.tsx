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
  version: 'history', shared: 'share', status: 'check', task: 'tasks',
}
export function EventAvatar({ e, size = 28 }: { e: EventRow; size?: number }) {
  return (
    <span className="event-avatar">
      <Avatar name={e.actor} color={colorFor(e.actor_id, e.actor_color)} image={e.actor_image} size={size} />
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

// The timeline. `here` is the document the page is about, so its own rows do not link back to it.
export function Activity({ events, here }: { events: EventRow[]; here?: string }) {
  if (events.length === 0) return null
  const days = new Map<string, EventRow[]>()
  for (const e of events) { const day = dayOf(e.at); days.set(day, [...(days.get(day) ?? []), e]) }
  return (
    <section className="activity" aria-labelledby="activity-title">
      <div className="activity-head">
        <h2 id="activity-title">Activity</h2>
        <span className="muted">{events.length === 1 ? '1 update' : `${events.length} updates`}</span>
      </div>
      {[...days].map(([day, rows]) => (
        <div key={day} className="activity-day">
          <h3>{day}</h3>
          <ol>
            {rows.map((e) => (
              <li key={e.id}>
                <EventAvatar e={e} />
                <div className="activity-body">
                  <p><strong>{e.actor}</strong> {e.text}</p>
                  {e.title && e.document_id && e.document_id !== here && (
                    <Link className="event-doc" to={`/doc/${e.document_id}`}><Icon name="docs" />{e.title}</Link>
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
