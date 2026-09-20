import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { standardKeymap } from '@codemirror/commands'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'

// One shared document. Every tab edits the same Y.Text, and Yjs merges the edits.
const doc = new Y.Doc()
const text = doc.getText('content')

// The provider ships updates to the server and reconnects on its own.
const url = import.meta.env.VITE_WS_URL || 'ws://localhost:8787'
const provider = new WebsocketProvider(url, 'main', doc)

// Presence: this tab's name and color, shared with the other tabs through "awareness".
const nameInput = document.querySelector<HTMLInputElement>('#name')!
// Dark enough that the white name label on top of them passes the contrast rule (4.5:1).
const colors = ['#c2185b', '#1565c0', '#2e7d32', '#bf360c', '#6a1b9a', '#00695c']
const setUser = (name: string) => {
  // Color comes from the name, so the same name gets the same color in every tab.
  const color = colors[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % colors.length]
  provider.awareness.setLocalStateField('user', { name, color, colorLight: color + '33' })
}
nameInput.value = 'Guest ' + Math.floor(Math.random() * 100)
setUser(nameInput.value)
nameInput.addEventListener('input', () => setUser(nameInput.value.trim() || 'Anonymous'))

// Status line: connection state and who is here, as text.
const status = document.querySelector<HTMLElement>('#status')!
const render = () => {
  const names = [...provider.awareness.getStates().values()].map(s => s.user?.name).filter(Boolean)
  status.textContent = `${provider.wsconnected ? 'Connected' : 'Offline'} · here: ${names.join(', ')}`
}
provider.on('status', render)
provider.awareness.on('change', render)

// Offline switch for the demo: the document keeps working, and syncs again on reconnect.
const toggle = document.querySelector<HTMLButtonElement>('#toggle')!
toggle.addEventListener('click', () => {
  if (provider.wsconnected) provider.disconnect(); else provider.connect()
  toggle.textContent = provider.shouldConnect ? 'Go offline' : 'Reconnect'
})

// The editor. yCollab binds it to the Y.Text and draws the other users' cursors.
new EditorView({
  state: EditorState.create({
    doc: text.toString(),
    extensions: [
      keymap.of([...yUndoManagerKeymap, ...standardKeymap]),
      EditorView.lineWrapping,
      placeholder('Type here. Then open this page in a second tab and watch it follow.'),
      EditorView.contentAttributes.of({ 'aria-label': 'Shared document' }),
      yCollab(text, provider.awareness),
    ],
  }),
  parent: document.querySelector('#editor')!,
})
