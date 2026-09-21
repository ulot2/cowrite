import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { withCollaboration } from '@blocknote/core/yjs'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'

export type ConnectionState = 'connected' | 'connecting' | 'disconnected'
export type Presence = { name: string; color: string; editing?: boolean }
type Props = {
  documentId: string
  user: { name: string; color: string }
  readOnly: boolean
  onStatus: (state: ConnectionState, others: Presence[]) => void
}

// Sends the picked image to the Worker, which stores it in R2 and answers with its URL.
const uploadFile = async (file: File) => {
  const res = await fetch('/upload', { method: 'POST', body: file, headers: { 'content-type': file.type, 'x-file-name': file.name } })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json() as { url: string }).url
}

// "light" or "dark", from the account setting on <html> or, failing that, the system.
const useTheme = () => {
  const read = () => (document.documentElement.dataset.theme as 'light' | 'dark' | undefined) ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const [theme, setTheme] = useState<'light' | 'dark'>(read)
  useEffect(() => {
    const update = () => setTheme(read())
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const media = matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', update)
    return () => { observer.disconnect(); media.removeEventListener('change', update) }
  }, [])
  return theme
}

// The shared editor. One Y.Doc and one socket per mounted editor; both go away with it.
export function RichEditor({ documentId, user, readOnly, onStatus }: Props) {
  const [sync] = useState(() => {
    const doc = new Y.Doc()
    // Same origin, /ws/<id>. disableBc: tabs must not relay presence to each other; the server owns it.
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    // connect: false. React (in development) runs this initializer twice and keeps one result;
    // a socket opened here would leak. The effect below connects, and disconnects on unmount.
    const provider = new WebsocketProvider(url, documentId, doc, { disableBc: true, connect: false })
    provider.awareness.setLocalStateField('user', user)
    return { doc, provider }
  })

  // The destroy waits one tick: a real unmount still frees everything, and the development
  // mount-unmount-mount does not kill the provider we keep.
  const destroyTimer = useRef<number>(undefined)
  useEffect(() => {
    clearTimeout(destroyTimer.current)
    const { doc, provider } = sync
    provider.connect()
    const report = () => {
      // Read the state, do not track events: the socket can open before this listener exists.
      const state: ConnectionState = provider.wsconnected ? 'connected' : provider.shouldConnect ? 'connecting' : 'disconnected'
      // Everyone else in the document. `cursor` is set by the editor while a selection is in the text.
      const others = [...provider.awareness.getStates()].filter(([id]) => id !== doc.clientID)
        .map(([, s]) => s.user && { ...s.user, editing: s.cursor != null }).filter(Boolean)
      onStatus(state, others)
    }
    provider.on('status', report)
    provider.awareness.on('change', report)
    report()
    return () => {
      provider.off('status', report)
      provider.awareness.off('change', report)
      provider.disconnect()
      destroyTimer.current = window.setTimeout(() => { provider.destroy(); doc.destroy() }, 0)
    }
  }, [sync, onStatus])

  const editor = useCreateBlockNote(withCollaboration({
    uploadFile,
    domAttributes: { editor: { 'aria-label': 'Document text' } },
    collaboration: {
      provider: sync.provider,
      fragment: sync.doc.getXmlFragment('document-store'),
      user,
      showCursorLabels: 'always',
    },
  }), [sync])

  return <BlockNoteView editor={editor} editable={!readOnly} theme={useTheme()} />
}
