import { Link } from 'react-router'
import type { EventRow } from '~/lib/events.server'
import { colorFor } from '~/lib/color'
import { timeAgo } from '~/lib/time'
import { Avatar } from './avatar'

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
      <h2 id="activity-title">Activity</h2>
      {[...days].map(([day, rows]) => (
        <div key={day} className="activity-day">
          <h3>{day}</h3>
          <ol>
            {rows.map((e) => (
              <li key={e.id}>
                <Avatar name={e.actor} color={colorFor(e.actor_id)} size={24} />
                <span className="activity-text">
                  <strong>{e.actor}</strong> {e.text}
                  {e.title && e.document_id !== here && <> · <Link to={`/doc/${e.document_id}`}>{e.title}</Link></>}
                </span>
                <time dateTime={new Date(e.at).toISOString()} className="muted">{timeAgo(e.at)}</time>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  )
}
