import { Link } from 'react-router'
import { timeAgo } from '~/lib/time'
import { Avatar } from './avatar'
import type { DocumentRow } from '~/lib/db.server'
import { statusLabel } from '~/lib/status'
import type { Hit } from '~/lib/search.server'

// A search snippet: the matched words sit between two control characters; mark them.
function Snippet({ hit }: { hit: Hit }) {
  const parts = hit.snippet.split(/[]/)
  return <span className="card-preview">{hit.kind === 'comments' && <span className="muted">In a comment: </span>}{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</span>
}

// One document as a card: title, the first lines, when it changed, who is on it.
export function DocCard({ doc, owner, index = 0, hit }: { doc: DocumentRow; owner: { name: string; color: string; image?: string | null }; index?: number; hit?: Hit | null }) {
  return (
    <Link to={`/doc/${doc.id}`} className="card" style={{ '--i': index } as React.CSSProperties}>
      <span className="card-title">{doc.title}{doc.status !== 'draft' && <span className="status" data-status={doc.status}>{statusLabel[doc.status]}</span>}</span>
      {doc.space_name && <span className="card-space">{doc.space_name}</span>}
      {hit && hit.kind !== 'title' ? <Snippet hit={hit} /> : <span className="card-preview">{doc.preview || 'Nothing written yet.'}</span>}
      <span className="card-meta">
        <span>Edited {timeAgo(doc.updated_at)}{doc.open_comments > 0 && ` · ${doc.open_comments} open ${doc.open_comments === 1 ? 'comment' : 'comments'}`}</span>
        <span className="avatars"><Avatar name={owner.name} color={owner.color} image={owner.image} size={24} /></span>
      </span>
    </Link>
  )
}
