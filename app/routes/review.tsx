import { env } from 'cloudflare:workers'
import { Link } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { listDocuments } from '~/lib/db.server'
import { atLeast } from '~/lib/roles'
import { timeAgo } from '~/lib/time'
import type { Route } from './+types/review'

export const meta = () => [{ title: 'Review · cowrite' }]

// Documents waiting for a review you can give: in review, you are a reviewer or above, and you
// did not submit it yourself. Oldest request first.
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const waiting = (await listDocuments(user.id)).filter((d) => d.status === 'review' && atLeast(d.role, 'reviewer'))
  if (!waiting.length) return { queue: [] }
  const { results } = await env.DB.prepare(
    `SELECT e.document_id, e.actor_id, u.name, MAX(e.at) AS at FROM events e JOIN "user" u ON u.id = e.actor_id
     WHERE e.text = 'submitted for review' AND e.document_id IN (SELECT value FROM json_each(?)) GROUP BY e.document_id`,
  ).bind(JSON.stringify(waiting.map((d) => d.id))).all<{ document_id: string; actor_id: string; name: string; at: number }>()
  const by = new Map(results.map((r) => [r.document_id, r]))
  const queue = waiting.filter((d) => by.get(d.id)?.actor_id !== user.id)
    .map((d) => ({ id: d.id, title: d.title, preview: d.preview, space: d.space_name, by: by.get(d.id)?.name ?? null, at: by.get(d.id)?.at ?? d.updated_at }))
    .sort((a, b) => a.at - b.at)
  return { queue }
}

export default function Review({ loaderData }: Route.ComponentProps) {
  const { queue } = loaderData
  return (
    <div className="page">
      <header className="page-title">
        <p className="eyebrow">Review</p>
        <h1>Waiting for your review</h1>
        <p className="muted">{queue.length === 0 ? 'Nothing to review. Documents submitted for review show up here.' : `${queue.length} ${queue.length === 1 ? 'document' : 'documents'}, oldest request first. They open with Suggest on.`}</p>
      </header>
      {queue.length > 0 && (
        <ol className="review-queue">
          {queue.map((d, i) => (
            <li key={d.id} style={{ '--i': i } as React.CSSProperties}>
              <Link to={`/doc/${d.id}?suggest=1`} className="card review-card">
                <span className="card-title">{d.title}</span>
                {d.space && <span className="card-space">{d.space}</span>}
                <span className="card-preview">{d.preview || 'Nothing written yet.'}</span>
                <span className="card-meta"><span>{d.by ? `${d.by} asked` : 'Asked'} {timeAgo(d.at)}</span></span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
