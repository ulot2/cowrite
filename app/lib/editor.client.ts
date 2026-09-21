import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { standardKeymap } from '@codemirror/commands'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'

export type ConnectionState = 'connected' | 'connecting' | 'disconnected'
export type Presence = { name: string; color: string }
export type EditorOptions = {
  documentId: string
  user: Presence
  readOnly: boolean
  onStatus: (state: ConnectionState, others: Presence[]) => void
}

// Mounts the shared editor into `parent`. Returns a cleanup function.
export function mountEditor(parent: HTMLElement, opts: EditorOptions) {
  // One shared document. Every tab edits the same Y.Text, and Yjs merges the edits.
  const doc = new Y.Doc()
  const text = doc.getText('content')

  // The provider ships updates to /ws/<id> on this origin and reconnects on its own.
  // disableBc: tabs of one browser must not relay presence to each other; the server owns it.
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
  const provider = new WebsocketProvider(wsUrl, opts.documentId, doc, { disableBc: true })
  provider.awareness.setLocalStateField('user', { ...opts.user, colorLight: opts.user.color + '33' })

  let state: ConnectionState = 'connecting'
  const report = () => {
    // Everyone else in the document. The local user is shown by the page itself.
    const others = [...provider.awareness.getStates()].filter(([id]) => id !== doc.clientID).map(([, s]) => s.user).filter(Boolean)
    opts.onStatus(state, others)
  }
  provider.on('status', ({ status }) => { state = status; report() })
  provider.awareness.on('change', report)

  const view = new EditorView({
    state: EditorState.create({
      doc: text.toString(),
      extensions: [
        keymap.of([...yUndoManagerKeymap, ...standardKeymap]),
        EditorView.lineWrapping,
        EditorView.editable.of(!opts.readOnly),
        EditorState.readOnly.of(opts.readOnly),
        placeholder(opts.readOnly ? 'Nothing here yet.' : 'Type here. Open this document in another tab, or share it, and watch it follow.'),
        EditorView.contentAttributes.of({ 'aria-label': 'Document text' }),
        yCollab(text, provider.awareness),
      ],
    }),
    parent,
  })

  return () => { view.destroy(); provider.destroy(); doc.destroy() }
}
