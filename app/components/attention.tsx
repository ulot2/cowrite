import { useState } from 'react'
import { Link } from 'react-router'
import { Avatar } from './avatar'

// One thing that waits for a person: a question to decide, a document to review, a task to do.
export type Waiting = { key: string; verb: 'Decide' | 'Review' | 'Do'; title: string; who: string | null; whoId: string | null; due: string | null; note?: string; to?: string; open?: () => void }

export const day = (d: string) => new Date(d + 'T00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })
export const today = () => new Date().toISOString().slice(0, 10)
const verbs = ['Decide', 'Review', 'Do'] as const

// What waits for someone, one hairline row each. The caller sorts the rows. `filtered` adds a chip
// per verb above them (Home, where the rows come from every space).
export function NeedsAttention({ rows: all, me, people = [], filtered = false }: { rows: Waiting[]; me: string; people?: { id: string; color: string; image?: string | null }[]; filtered?: boolean }) {
  const [more, setMore] = useState(false)
  const [verb, setVerb] = useState<Waiting['verb'] | null>(null)
  const rows = verb ? all.filter((r) => r.verb === verb) : all
  const shown = more ? rows : rows.slice(0, 6)
  return (
    <section className="attention" aria-labelledby="attention-title">
      <div className="block-head">
        <h2 id="attention-title">Needs attention{all.length > 0 && <span className="count">{all.length}</span>}</h2>
        {filtered && all.length > 0 && (
          <div className="activity-filters" role="group" aria-label="Show">
            <button type="button" aria-pressed={!verb} onClick={() => setVerb(null)}>All</button>
            {verbs.map((v) => {
              const n = all.filter((r) => r.verb === v).length
              return n > 0 && <button key={v} type="button" aria-pressed={verb === v} onClick={() => setVerb(v)}>{v} {n}</button>
            })}
          </div>
        )}
      </div>
      {rows.length === 0 ? <p className="attention-empty">Nothing needs anyone right now.</p> : (
        <ul className="attention-rows">
          {shown.map((r) => {
            const late = !!r.due && r.due < today()
            const body = (
              <>
                <span className="verb" data-verb={r.verb}>{r.verb}</span>
                <span className="attention-title">{r.title}</span>
                <span className="attention-meta">
                  {r.whoId === me ? <span className="you">You</span> : r.who && <>{r.whoId && <Avatar name={r.who} color={people.find((p) => p.id === r.whoId)?.color ?? 'var(--fg-muted)'} image={people.find((p) => p.id === r.whoId)?.image} size={20} />}{r.who}</>}
                  {r.note && <span className="attention-note">{r.note}</span>}
                  {r.due && <time dateTime={r.due} data-late={late || undefined}>{late ? `Was due ${day(r.due)}` : day(r.due)}</time>}
                </span>
              </>
            )
            return <li key={r.key} data-late={late || undefined}>{r.to ? <Link to={r.to}>{body}</Link> : <button type="button" onClick={r.open}>{body}</button>}</li>
          })}
        </ul>
      )}
      {rows.length > 6 && <button type="button" className="link-button attention-more" onClick={() => setMore(!more)}>{more ? 'Show fewer' : `Show ${rows.length - 6} more`}</button>}
    </section>
  )
}
