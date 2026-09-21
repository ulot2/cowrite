import { Link } from 'react-router'
import { timeAgo } from '~/lib/time'
import { Avatar } from './avatar'
import type { DocumentRow } from '~/lib/db.server'

// One document as a card: title, the first lines, when it changed, who is on it.
export function DocCard({ doc, owner, index = 0 }: { doc: DocumentRow; owner: { name: string; color: string }; index?: number }) {
  return (
    <Link to={`/doc/${doc.id}`} className="card" style={{ '--i': index } as React.CSSProperties}>
      <span className="card-title">{doc.title}</span>
      <span className="card-preview">{doc.preview || 'Nothing written yet.'}</span>
      <span className="card-meta">
        <span>Edited {timeAgo(doc.updated_at)}{doc.open_comments > 0 && ` · ${doc.open_comments} open ${doc.open_comments === 1 ? 'comment' : 'comments'}`}</span>
        <span className="avatars"><Avatar name={owner.name} color={owner.color} size={24} /></span>
      </span>
    </Link>
  )
}
