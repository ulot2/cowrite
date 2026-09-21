import { useEffect, useRef, useState } from 'react'
import type { ConnectionState, Presence } from '~/lib/editor.client'
import { Avatar } from './avatar'

const notes: Record<ConnectionState, string | null> = {
  connected: null,
  connecting: 'Connecting…',
  disconnected: 'Offline. Changes are saved here and sync when you are back.',
}

export function Editor({ documentId, user, readOnly, children }: { documentId: string; user: Presence; readOnly: boolean; children?: React.ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<{ state: ConnectionState; others: Presence[] }>({ state: 'connecting', others: [] })

  useEffect(() => {
    let destroy: (() => void) | undefined
    let cancelled = false
    // Loaded in the browser only: CodeMirror needs a DOM, and the server has none.
    import('~/lib/editor.client').then(({ mountEditor }) => {
      if (cancelled || !host.current) return
      destroy = mountEditor(host.current, { documentId, user, readOnly, onStatus: (state, others) => setStatus({ state, others }) })
    })
    return () => { cancelled = true; destroy?.() }
  }, [documentId, user.name, user.color, readOnly])

  const note = notes[status.state]
  return (
    <>
      <div className="presence" role="status">
        {note && <span className="pill" data-state={status.state}>{note}</span>}
        <span className="avatars" aria-label={`In this document: you${status.others.map((o) => ', ' + o.name).join('')}`}>
          {status.others.map((o, i) => <Avatar key={o.name + i} name={o.name} color={o.color} />)}
          <Avatar name={user.name} color={user.color} />
        </span>
      </div>
      {children}
      <div id="editor" ref={host} />
    </>
  )
}
