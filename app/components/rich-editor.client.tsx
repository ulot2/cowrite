import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { createUserStore } from '@blocknote/core'
import { CommentsExtension, DefaultThreadStoreAuth } from '@blocknote/core/comments'
import { withCollaboration, YjsThreadStore } from '@blocknote/core/yjs'
import { BlockNoteViewEditor, ThreadsSidebar, useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'

export type ConnectionState = 'connected' | 'connecting' | 'disconnected'
export type Presence = { name: string; color: string; editing?: boolean }
type Props = {
  documentId: string
  user: { id: string; name: string; color: string }
  readOnly: boolean
  panel: 'none' | 'open' | 'resolved'
  onStatus: (state: ConnectionState, others: Presence[], openComments: number) => void
}

// Sends the picked image to the Worker, which stores it in R2 and answers with its URL.
const uploadFile = async (file: File) => {
  const res = await fetch('/upload', { method: 'POST', body: file, headers: { 'content-type': file.type, 'x-file-name': file.name } })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json() as { url: string }).url
}

// Names and avatars for the people in the comments, fetched once per id and cached by the store.
const users = createUserStore(async (ids) => {
  const res = await fetch(`/api/users?ids=${encodeURIComponent(ids.join(','))}`)
  return res.ok ? (res.json() as Promise<{ id: string; username: string; avatarUrl: string }[]>) : []
})

// The library's comment actions are icon-only buttons with no accessible name. Give them one.
const actionLabels: Record<string, string> = { addreaction: 'Add reaction', resolve: 'Resolve', unresolve: 'Reopen', moreactions: 'More actions', 'add-comment': 'Add comment', edit: 'Edit', delete: 'Delete' }
const useActionLabels = (root: React.RefObject<HTMLElement | null>) => {
  useEffect(() => {
    if (!root.current) return
    const label = () => root.current?.querySelectorAll<HTMLElement>('button[data-test]:not([aria-label])').forEach((b) => {
      const name = actionLabels[b.dataset.test ?? '']
      if (name) b.setAttribute('aria-label', name)
    })
    const observer = new MutationObserver(label)
    observer.observe(root.current, { childList: true, subtree: true })
    label()
    return () => observer.disconnect()
  }, [root])
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
export function RichEditor({ documentId, user, readOnly, panel, onStatus }: Props) {
  const [sync] = useState(() => {
    const doc = new Y.Doc()
    // Same origin, /ws/<id>. disableBc: tabs must not relay presence to each other; the server owns it.
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    // connect: false. React (in development) runs this initializer twice and keeps one result;
    // a socket opened here would leak. The effect below connects, and disconnects on unmount.
    const provider = new WebsocketProvider(url, documentId, doc, { disableBc: true, connect: false })
    provider.awareness.setLocalStateField('user', { name: user.name, color: user.color })
    // Comment threads live in the document too, so they sync and survive offline like the text.
    const threads = doc.getMap('threads')
    const threadStore = new YjsThreadStore(user.id, threads, new DefaultThreadStoreAuth(user.id, 'editor'))
    return { doc, provider, threads, threadStore }
  })

  // The destroy waits one tick: a real unmount still frees everything, and the development
  // mount-unmount-mount does not kill the provider we keep.
  const destroyTimer = useRef<number>(undefined)
  useEffect(() => {
    clearTimeout(destroyTimer.current)
    const { doc, provider, threads } = sync
    provider.connect()
    const report = () => {
      // Read the state, do not track events: the socket can open before this listener exists.
      const state: ConnectionState = provider.wsconnected ? 'connected' : provider.shouldConnect ? 'connecting' : 'disconnected'
      // Everyone else in the document. `cursor` is set by the editor while a selection is in the text.
      const others = [...provider.awareness.getStates()].filter(([id]) => id !== doc.clientID)
        .map(([, s]) => s.user && { ...s.user, editing: s.cursor != null }).filter(Boolean)
      const open = [...threads.values()].filter((t) => (t as Y.Map<unknown>).get('resolved') !== true).length
      onStatus(state, others, open)
    }
    provider.on('status', report)
    provider.awareness.on('change', report)
    threads.observeDeep(report)
    report()
    return () => {
      provider.off('status', report)
      provider.awareness.off('change', report)
      threads.unobserveDeep(report)
      provider.disconnect()
      destroyTimer.current = window.setTimeout(() => { provider.destroy(); doc.destroy() }, 0)
    }
  }, [sync, onStatus])

  const editor = useCreateBlockNote(withCollaboration({
    uploadFile,
    domAttributes: { editor: { 'aria-label': 'Document text' } },
    extensions: [CommentsExtension({ threadStore: sync.threadStore, resolveUsers: users })],
    collaboration: {
      provider: sync.provider,
      fragment: sync.doc.getXmlFragment('document-store'),
      user: { name: user.name, color: user.color },
      showCursorLabels: 'always',
    },
  }), [sync])

  const root = useRef<HTMLDivElement>(null)
  useActionLabels(root)

  return (
    <BlockNoteView editor={editor} editable={!readOnly} comments={!readOnly} theme={useTheme()} renderEditor={false}>
      <div className="editor-layout" data-panel={panel} ref={root}>
        <div className="editor-column"><BlockNoteViewEditor /></div>
        {panel !== 'none' && (
          <aside className="comments-panel" aria-label={panel === 'open' ? 'Open comments' : 'Resolved comments'}>
            <ThreadsSidebar filter={panel} sort="position" />
          </aside>
        )}
      </div>
    </BlockNoteView>
  )
}
