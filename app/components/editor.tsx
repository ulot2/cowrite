import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { ConnectionState, Panel, Presence } from './rich-editor.client'
import { Avatar } from './avatar'
import { Icon } from './icon'

const notes: Record<ConnectionState, string | null> = {
  connected: null,
  connecting: 'Connecting…',
  disconnected: 'Offline. Changes are saved here and sync when you are back.',
}

// The editor needs a DOM, so it loads in the browser only, after the first paint.
const RichEditor = lazy(() => import('./rich-editor.client').then((m) => ({ default: m.RichEditor })))
const Board = lazy(() => import('./board.client').then((m) => ({ default: m.Board })))

type Props = {
  documentId: string
  user: { id: string; name: string; color: string }
  canEdit: boolean
  canComment: boolean
  // A reviewer must suggest; an editor may. Only editors accept or reject.
  canSuggest: boolean
  mustSuggest: boolean
  canResolve: boolean
  people: { id: string; name: string }[]
  kind?: 'doc' | 'board'
  crumbs: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
}

// One header row: where you are on the left, who is here and the tools on the right.
// On phones the tools keep only their icons; the label stays for screen readers.
export function Editor({ documentId, user, canEdit, canComment, canSuggest, mustSuggest, canResolve, people, kind = 'doc', crumbs, actions, children }: Props) {
  const board = kind === 'board'
  const [mounted, setMounted] = useState(false)
  const [status, setStatus] = useState<{ state: ConnectionState; others: Presence[]; open: number }>({ state: 'connecting', others: [], open: 0 })
  const [panel, setPanel] = useState<Panel>('none')
  // The review queue opens documents with ?suggest=1, so a review starts in Suggest mode.
  const [params] = useSearchParams()
  const [suggesting, setSuggesting] = useState(mustSuggest || (canSuggest && params.get('suggest') === '1'))
  useEffect(() => setMounted(true), [])
  const onStatus = useCallback((state: ConnectionState, others: Presence[], open: number) => setStatus({ state, others, open }), [])

  const note = notes[status.state]
  return (
    <>
      <div className="doc-bar">
        {crumbs}
        <div className="doc-tools">
          <span role="status" className="presence">
            {note && <span className="pill" data-state={status.state}>{note}</span>}
            <span className="avatars" aria-label={`In this document: you${status.others.map((o) => `, ${o.name}${o.editing ? ' (editing)' : ''}`).join('')}`}>
              {status.others.map((o, i) => <span key={o.name + i} className="who-is" data-editing={o.editing}><Avatar name={o.name} color={o.color} /></span>)}
              <Avatar name={user.name} color={user.color} />
            </span>
          </span>
          {canSuggest && !board && (
            <button type="button" className="tool" aria-pressed={suggesting} disabled={mustSuggest} title={mustSuggest ? 'As a reviewer, your edits are suggestions' : 'Suggest changes'} onClick={() => setSuggesting(!suggesting)}>
              <Icon name="suggest" /><span className="tool-label">Suggest</span>
            </button>
          )}
          {!board && canEdit && <button type="button" className="tool" title="Ask AI" data-ai-open aria-haspopup="dialog" aria-expanded={panel === 'ai'} onClick={() => setPanel(panel === 'ai' ? 'none' : 'ai')}><Icon name="sparkle" /><span className="tool-label">AI</span></button>}
          {!board && <><button type="button" className="tool" title="Outline" aria-pressed={panel === 'outline'} onClick={() => setPanel(panel === 'outline' ? 'none' : 'outline')}>
            <Icon name="outline" /><span className="tool-label">Outline</span>
          </button>
          <button type="button" className="tool" title="Comments" aria-pressed={panel === 'open' || panel === 'resolved'} onClick={() => setPanel(panel === 'open' || panel === 'resolved' ? 'none' : 'open')}>
            <Icon name="comment" /><span className="tool-label">Comments</span>{status.open > 0 && <span className="count">{status.open}</span>}
          </button></>}
          {actions}
        </div>
      </div>
      {children}
      <div id="editor">
        {mounted && (
          <Suspense fallback={<p className="muted">Loading the editor…</p>}>
            {board ? <Board documentId={documentId} user={user} canEdit={canEdit} people={people} onStatus={onStatus} /> : <RichEditor documentId={documentId} user={user} canEdit={canEdit} canComment={canComment} suggesting={suggesting} canResolve={canResolve} people={people} panel={panel} onPanel={setPanel} onStatus={onStatus} />}
          </Suspense>
        )}
      </div>
    </>
  )
}
