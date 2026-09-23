import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { BlockNoteEditor } from '@blocknote/core'
import { useComponentsContext } from '@blocknote/react'
import { selectSuggestion } from '@handlewithcare/prosemirror-suggest-changes'
import { readSuggestions, suggestAs } from './suggestions.client'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Editor = BlockNoteEditor<any, any, any>

const groups: { label: string; selection?: true; items: [string, string][] }[] = [
  { label: 'Edit selection', selection: true, items: [['improve', 'Improve writing'], ['fix', 'Fix spelling and grammar'], ['shorten', 'Make shorter']] },
  { label: 'Write', items: [['continue', 'Continue writing']] },
  { label: 'Whole document', items: [['summarize', 'Summarize at the top'], ['actions', 'Extract action items'], ['contradictions', 'Find contradictions']] },
]

// The button in the selection toolbar. `data-ai-open` marks every control that opens the menu,
// so a click on one is not read as a click outside.
export function AskAiButton({ onOpen }: { onOpen: () => void }) {
  const Components = useComponentsContext()!
  return (
    <Components.FormattingToolbar.Button mainTooltip="Ask AI" label="Ask AI" onClick={onOpen}>
      <span className="ask-ai" data-ai-open><span aria-hidden="true">✦</span> Ask AI</span>
    </Components.FormattingToolbar.Button>
  )
}

// The AI menu: next to the selected text (or under the header's AI button) on a wide screen,
// a bottom sheet on a phone. The answer goes into the text as a suggestion by "ai", then the
// menu closes and the new suggestion is selected, so the bar offers Accept and Reject at once.
export function AiMenu({ editor, documentId, onClose }: { editor: Editor; documentId: string; onClose: () => void }) {
  const view = editor.prosemirrorView!
  const [hasSelection] = useState(() => !view.state.selection.empty)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [pos, setPos] = useState<CSSProperties | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const menu = ref.current!
    if (matchMedia('(max-width: 600px)').matches) return setPos({}) // the CSS makes it a sheet
    const w = menu.offsetWidth, h = menu.offsetHeight
    const sel = view.state.selection
    const at = sel.empty ? null : view.coordsAtPos(sel.to)
    let top: number, left: number
    if (at && at.bottom > 56 && at.bottom < innerHeight - 40) {
      top = at.bottom + 8
      left = view.coordsAtPos(sel.from).left
      if (top + h > innerHeight - 12) top = Math.max(12, view.coordsAtPos(sel.from).top - h - 8)
    } else {
      const b = document.querySelector('.doc-tools [data-ai-open]')?.getBoundingClientRect()
      top = (b?.bottom ?? 64) + 8
      left = (b?.right ?? innerWidth - 12) - w
    }
    setPos({ top, left: Math.min(Math.max(12, left), innerWidth - w - 12) })
  }, [view])

  // Focus the first command; Escape or a click outside closes (not while the AI is working).
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  }, [])
  const busyRef = useRef(busy)
  busyRef.current = busy
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busyRef.current) { onClose(); editor.focus() } }
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!busyRef.current && !ref.current?.contains(t) && !t.closest('[data-ai-open]')) onClose()
    }
    document.addEventListener('keydown', key)
    document.addEventListener('mousedown', down)
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', down) }
  }, [editor, onClose])

  const run = async (command: string) => {
    const { from, to, $to } = view.state.selection
    // Rewrites send only the selection; "continue" sends the text before the cursor.
    const text = command === 'continue' ? view.state.doc.textBetween(0, $to.end(), '\n').slice(-4000) : view.state.doc.textBetween(from, to, '\n')
    setBusy(command); setError('')
    try {
      const res = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId, command, text }) })
      const out = await res.json().catch(() => ({})) as { text?: string; error?: string }
      if (!res.ok || !out.text) throw new Error(out.error ?? 'The AI did not answer. Try again.')
      const answer = out.text
      // List answers: one item per line, without bullets or numbers.
      const lines = answer.split('\n').map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim()).filter((l) => l && !/^none found\.?$/i.test(l))
      if ((command === 'actions' || command === 'contradictions') && !lines.length) throw new Error(command === 'actions' ? 'The AI found no action items.' : 'The AI found no contradictions.')
      const before = new Set(readSuggestions(view.state).all.map((s) => s.id))
      const last = editor.document[editor.document.length - 1]
      suggestAs(view, 'ai', () => {
        const sel = view.state.selection
        if (command === 'improve' || command === 'fix' || command === 'shorten') view.dispatch(view.state.tr.insertText(answer, sel.from, sel.to))
        else if (command === 'continue') view.dispatch(view.state.tr.insertText(' ' + answer, sel.$to.end()))
        else if (command === 'summarize') editor.insertBlocks([{ type: 'paragraph', content: answer }], editor.document[0], 'before')
        else if (command === 'actions') editor.insertBlocks(lines.map((l) => ({ type: 'task', props: { taskId: crypto.randomUUID() }, content: l })), last, 'after')
        else editor.insertBlocks(lines.map((l) => ({ type: 'bulletListItem', content: l })), last, 'after')
      })
      const added = readSuggestions(view.state).all.find((s) => s.author === 'ai' && !before.has(s.id))
      onClose()
      if (added) {
        selectSuggestion(added.id)(view.state, view.dispatch)
        view.dispatch(view.state.tr.scrollIntoView())
        view.focus()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  return (
    <>
      <div className="ai-scrim" aria-hidden="true" />
      <div ref={ref} className="ai-menu" role="dialog" aria-label="Ask AI" style={pos ?? { visibility: 'hidden' }}>
        <div className="ai-menu-head">
          <span className="ai-mark" aria-hidden="true">✦</span>
          <strong>Ask AI</strong>
          <span className="muted small">{busy ? 'Writing…' : 'Answers arrive as suggestions'}</span>
        </div>
        {groups.map((g) => (
          <div key={g.label} className="ai-group" role="group" aria-label={g.label}>
            <p className="ai-group-label">{g.label}{g.selection && !hasSelection && <span> · select text first</span>}</p>
            {g.items.map(([id, label]) => (
              <button key={id} type="button" className="ai-item" disabled={(g.selection && !hasSelection) || !!busy} aria-busy={busy === id} onClick={() => run(id)}>
                {busy === id ? <span className="spinner" aria-hidden="true" /> : <span className="ai-mark" aria-hidden="true">✦</span>}
                {label}
              </button>
            ))}
          </div>
        ))}
        {error && <p className="ai-error" role="alert">{error}</p>}
      </div>
    </>
  )
}
