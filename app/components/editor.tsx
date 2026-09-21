import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { ConnectionState, Presence } from './rich-editor.client'
import { Avatar } from './avatar'

const notes: Record<ConnectionState, string | null> = {
  connected: null,
  connecting: 'Connecting…',
  disconnected: 'Offline. Changes are saved here and sync when you are back.',
}

// The editor needs a DOM, so it loads in the browser only, after the first paint.
const RichEditor = lazy(() => import('./rich-editor.client').then((m) => ({ default: m.RichEditor })))

export function Editor({ documentId, user, readOnly, children }: { documentId: string; user: { name: string; color: string }; readOnly: boolean; children?: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const [status, setStatus] = useState<{ state: ConnectionState; others: Presence[] }>({ state: 'connecting', others: [] })
  useEffect(() => setMounted(true), [])
  const onStatus = useCallback((state: ConnectionState, others: Presence[]) => setStatus({ state, others }), [])

  const note = notes[status.state]
  return (
    <>
      <div className="presence" role="status">
        {note && <span className="pill" data-state={status.state}>{note}</span>}
        <span className="avatars" aria-label={`In this document: you${status.others.map((o) => `, ${o.name}${o.editing ? ' (editing)' : ''}`).join('')}`}>
          {status.others.map((o, i) => <span key={o.name + i} className="who-is" data-editing={o.editing}><Avatar name={o.name} color={o.color} /></span>)}
          <Avatar name={user.name} color={user.color} />
        </span>
      </div>
      {children}
      <div id="editor">
        {mounted && (
          <Suspense fallback={<p className="muted">Loading the editor…</p>}>
            <RichEditor documentId={documentId} user={user} readOnly={readOnly} onStatus={onStatus} />
          </Suspense>
        )}
      </div>
    </>
  )
}
