import { useEffect } from 'react'
import { Link, useFetcher } from 'react-router'
import { Icon } from './icon'
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
  return (
    <details className="account inbox" onToggle={(e) => { if (e.currentTarget.open && unseen > 0) seen.submit(null, { method: 'post', action: '/api/inbox' }) }}>
      <summary className="tool" aria-label={unseen > 0 ? `Notifications, ${unseen} new` : 'Notifications'}>
        <Icon name="bell" />{unseen > 0 && <span className="count">{unseen > 20 ? '20+' : unseen}</span>}
      </summary>
      <div className="popover inbox-list">
        <p className="who"><strong>Notifications</strong><span>What happened in your documents</span></p>
        {!data ? <p className="muted small inbox-empty">Loading…</p> : data.events.length === 0 ? <p className="muted small inbox-empty">Nothing yet. Activity by other people in your documents shows here.</p> : (
          <ol>
            {data.events.map((e) => (
              <li key={e.id} data-new={e.at > data.since}>
                <span className="inbox-text"><strong>{e.actor}</strong> {e.text}{e.title && e.document_id && <> · <Link to={`/doc/${e.document_id}`}>{e.title}</Link></>}</span>
                <time dateTime={new Date(e.at).toISOString()} className="muted">{timeAgo(e.at)}</time>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  )
}
