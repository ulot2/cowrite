/* Connected work extends Studio: a quiet disclosure, factual relationship rows,
   and an inline linking form. The current item stays primary; source links and
   the wider chain are available without leaving the work. */
import { useEffect, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { kindLabel, workKey, type ConnectionsResult, type WorkKind } from '~/lib/connections'
import { Icon } from './icon'
import { Select } from './select'
import { WorkPicker } from './work-picker'

const icons = { idea: 'board', discussion: 'comment', decision: 'check', document: 'docs', task: 'tasks' } as const
export function ConnectedWork({ kind, id, compact = false, defaultOpen = false }: { kind: WorkKind; id: string; compact?: boolean; defaultOpen?: boolean }) {
  const fetcher = useFetcher<ConnectionsResult>()
  const { load } = fetcher
  const [open, setOpen] = useState(defaultOpen)
  const [adding, setAdding] = useState(false)
  const [full, setFull] = useState(false)
  const [selected, setSelected] = useState('')
  useEffect(() => { if (defaultOpen) setOpen(true) }, [defaultOpen])
  const url = `/api/connections?${new URLSearchParams({ kind, id })}`
  useEffect(() => { if (open) load(`/api/connections?${new URLSearchParams({ kind, id })}`) }, [open, kind, id, load])
  const data = fetcher.data && 'anchor' in fetcher.data && fetcher.data.anchor.kind === kind && fetcher.data.anchor.id === id ? fetcher.data : null
  useEffect(() => {
    if (fetcher.data && 'message' in fetcher.data && fetcher.data.message === 'Work connected.') {
      setAdding(false); setSelected('')
    }
  }, [fetcher.data])
  const busy = fetcher.state !== 'idle'
  const candidates = data?.candidates ?? []
  const target = candidates.find((n) => workKey(n) === selected)
  const canImplement = (kind === 'decision' && (target?.kind === 'task' || target?.kind === 'document'))
    || (target?.kind === 'decision' && (kind === 'task' || kind === 'document'))
  const items = data?.items.filter((n) => full || n.depth === 1) ?? []
  const indirect = data?.items.filter((n) => n.depth > 1).length ?? 0
  const error = fetcher.data?.error
  return (
    <details data-disclosure className={`connected-work${compact ? ' connected-work-compact' : ''}`} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><Icon name="link" /><span>Connected work</span>{data && <span className="count">{data.items.length}</span>}<Icon name="chevron" /></summary>
      {open && <div className="connections-body">
        {busy && !data && <p className="muted small" role="status">Finding connected work…</p>}
        {error && <p className="error small" role="alert">{error} <button type="button" className="link-button" onClick={() => load(url)} disabled={busy}>Try again</button></p>}
        {data && <>
          <div className="connections-head"><p className="muted small">Sources, outcomes, and work that carries this forward.</p><button type="button" className="link-button small" disabled={busy} onClick={() => load(url)}>Refresh</button></div>
          {items.length ? <ul className="connection-list">
            {items.map((item) => <li key={workKey(item)}>
              <Icon name={icons[item.kind]} />
              <Link to={item.href} className="connection-item"><span className="connection-reason">{item.reason}</span><span className="connection-label">{item.label}</span><span className="connection-kind">{kindLabel[item.kind]} · {item.status === 'review' ? 'In review' : item.status.charAt(0).toUpperCase() + item.status.slice(1)}</span></Link>
              {data.canManage && item.linkId && <fetcher.Form method="post" action="/api/connections">
                <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="intent" value="unlink" /><input type="hidden" name="link" value={item.linkId} />
                <button type="submit" className="ghost connection-remove" disabled={busy} aria-label={`Remove connection to ${item.label}`} title="Remove connection"><Icon name="close" /></button>
              </fetcher.Form>}
            </li>)}
          </ul> : <p className="muted small connections-empty">No connected work yet.{data.canManage ? ' Connect an existing item, or make a document or discussion from an idea.' : ''}</p>}
          {indirect > 0 && <button type="button" className="link-button small" aria-expanded={full} onClick={() => setFull(!full)}>{full ? 'Show direct connections' : `Show the wider chain (${indirect} more)`}</button>}
          {full && data.truncated && <p className="muted small">Showing the closest 60 items. Open an item to follow its connections further.</p>}
          {data.canManage && <div className="connections-manage">
            {!adding ? <button type="button" className="ghost small" onClick={() => setAdding(true)}><Icon name="plus" />Connect existing work</button> : <fetcher.Form method="post" action="/api/connections" className="connection-form" aria-label="Connect work">
              <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="intent" value="link" />
              <div className="connection-form-heading"><strong>Connect existing work</strong><p>Choose an item and how it connects.</p></div>
              <div className="connection-form-fields">
                <div className="connection-field"><span className="connection-field-label">Work item</span><WorkPicker items={candidates} value={selected} onChange={setSelected} disabled={busy} /></div>
                <div className="connection-field"><span className="connection-field-label">Relationship</span><Select key={canImplement ? 'implementation' : 'related'} name="relation" label="Relationship" disabled={busy} defaultValue={canImplement ? 'implements' : 'related'} className="connection-relation"
                  options={[{ value: 'related', label: 'Related work', hint: 'Keep these items connected' }, ...(canImplement ? [{ value: 'implements', label: kind === 'decision' ? 'Implements this decision' : 'Implements that decision', hint: 'Carries the decision into action' }] : [])]} /></div>
              </div>
              <div className="connection-form-footer"><p className="muted small">Connections respect existing access.</p><div className="form-actions"><button type="button" className="ghost" disabled={busy} onClick={() => setAdding(false)}>Cancel</button><button type="submit" className="primary" disabled={busy || !target}><Icon name="link" />{busy ? 'Connecting…' : 'Connect work'}</button></div></div>
            </fetcher.Form>}
          </div>}
          {fetcher.data && 'message' in fetcher.data && fetcher.data.message && <p className="small muted" role="status">{fetcher.data.message}</p>}
        </>}
      </div>}
    </details>
  )
}
