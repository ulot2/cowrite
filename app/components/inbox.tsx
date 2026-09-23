import { useEffect, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { Icon } from './icon'
import { EventAvatar } from './activity'
import type { loader } from '~/routes/api.inbox'
import { timeAgo } from '~/lib/time'

// The bell. Polls /api/inbox every 30 s and when the tab comes back; opening it marks everything seen.
export function Inbox() {
  const poll = useFetcher<typeof loader>()
  const seen = useFetcher()
  useEffect(() => {
    const load = () => { if (document.visibilityState === 'visible') poll.load('/api/inbox') }
    load()
    const timer = setInterval(load, 30000)
    addEventListener('focus', load)
    return () => { clearInterval(timer); removeEventListener('focus', load) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll.load is stable for the fetcher's life
  }, [])
  // After "seen" is written, read again so the badge and the "new" dots follow.
  useEffect(() => { if (seen.data) poll.load('/api/inbox') }, [seen.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const data = poll.data
  const unseen = seen.state !== 'idle' ? 0 : data?.unseen ?? 0
  // New since the bell was last opened, then the rest. Opening it marks everything seen and reloads,
  // so the time from before that opening is kept while the list is open.
  const [openedSince, setOpenedSince] = useState<number | null>(null)
  const since = openedSince ?? data?.since ?? 0
  const events = data?.events ?? []
  const groups: [string, typeof events][] = [['New', events.filter((e) => e.at > since)], ['Earlier', events.filter((e) => e.at <= since)]]
  const newCount = groups[0][1].length
  return (
    <details className="account inbox" onToggle={(e) => {
      if (!e.currentTarget.open) return setOpenedSince(null)
      setOpenedSince(data?.since ?? 0)
      if (unseen > 0) seen.submit(null, { method: 'post', action: '/api/inbox' })
    }}>
      <summary className="tool" aria-label={unseen > 0 ? `Notifications, ${unseen} new` : 'Notifications'}>
        <Icon name="bell" />{unseen > 0 && <span className="count">{unseen > 20 ? '20+' : unseen}</span>}
      </summary>
      <div className="popover inbox-list">
        <div className="inbox-head">
          <strong>Notifications</strong>
          {newCount > 0 && <span className="inbox-new">{newCount} new</span>}
        </div>
        {!data ? <p className="muted small inbox-empty">Loading…</p> : data.events.length === 0 ? (
          <div className="inbox-empty">
            <span className="inbox-empty-icon" aria-hidden="true"><Icon name="bell" /></span>
            <strong>You are all caught up</strong>
            <span className="muted small">When people edit, comment, or mention you in your documents, it shows here.</span>
          </div>
        ) : (
          <div className="inbox-scroll">
            {groups.map(([label, rows]) => rows.length > 0 && (
              <section key={label} aria-label={label}>
                <h3>{label}</h3>
                <ol>
                  {rows.map((e) => {
                    const body = (
                      <>
                        <EventAvatar e={e} size={32} />
                        <span className="inbox-body">
                          <span className="inbox-text"><strong>{e.actor}</strong> {e.text}</span>
                          <span className="inbox-meta">
                            {e.title && <span className="inbox-doc">{e.title}</span>}
                            <time dateTime={new Date(e.at).toISOString()}>{timeAgo(e.at)}</time>
                          </span>
                        </span>
                      </>
                    )
                    return (
                      <li key={e.id} data-new={e.at > since}>
                        {e.document_id && e.title ? <Link to={`/doc/${e.document_id}`}>{body}</Link> : <div>{body}</div>}
                      </li>
                    )
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </details>
  )
}
