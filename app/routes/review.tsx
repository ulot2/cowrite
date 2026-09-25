import { Link } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { reviewQueue } from '~/lib/db.server'
import { timeAgo } from '~/lib/time'
import type { Route } from './+types/review'

export const meta = () => [{ title: 'Review · cowrite' }]

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  return { queue: await reviewQueue(user.id) }
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
