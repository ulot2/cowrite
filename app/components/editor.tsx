import { useEffect, useRef, useState } from 'react'
import type { ConnectionState } from '~/lib/editor.client'

const labels: Record<ConnectionState, string> = { connected: 'Connected', connecting: 'Connecting…', disconnected: 'Offline' }

export function Editor({ documentId, user, readOnly }: { documentId: string; user: { name: string; color: string }; readOnly: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const handle = useRef<{ toggle: () => void; destroy: () => void }>(null)
  const [status, setStatus] = useState<{ state: ConnectionState; names: string[]; wants: boolean }>({ state: 'connecting', names: [], wants: true })

  useEffect(() => {
    let cancelled = false
    // Loaded in the browser only: CodeMirror needs a DOM, and the server has none.
    import('~/lib/editor.client').then(({ mountEditor }) => {
      if (cancelled || !host.current) return
      handle.current = mountEditor(host.current, {
        documentId, user, readOnly,
        onStatus: (state, names, wants) => setStatus({ state, names, wants }),
      })
    })
    return () => { cancelled = true; handle.current?.destroy(); handle.current = null }
  }, [documentId, user.name, user.color, readOnly])

  return (
    <>
      <div className="editor-bar">
        <p id="status" role="status" data-state={status.state}>
          <span className="dot" aria-hidden="true" />
          <span>{labels[status.state]}{status.names.length ? ` · ${status.names.join(', ')}` : ''}</span>
        </p>
        <button type="button" onClick={() => handle.current?.toggle()}>{status.wants ? 'Go offline' : 'Reconnect'}</button>
      </div>
      <div id="editor" ref={host} />
    </>
  )
}
