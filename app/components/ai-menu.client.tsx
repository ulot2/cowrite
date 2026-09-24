import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { BlockNoteEditor } from '@blocknote/core'
import { useComponentsContext, type SuggestionMenuProps, type DefaultReactSuggestionItem } from '@blocknote/react'
import { selectSuggestion } from '@handlewithcare/prosemirror-suggest-changes'
import { readSuggestions, suggestAs } from './suggestions.client'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Editor = BlockNoteEditor<any, any, any>

// Nib is the assistant's name. Its answers are suggestions by the user id "ai".
export const NIB = 'Nib'

const groups: { label: string; selection?: true; items: [string, string][] }[] = [
  { label: 'Edit selection', selection: true, items: [['improve', 'Improve writing'], ['fix', 'Fix spelling and grammar'], ['shorten', 'Make shorter']] },
  { label: 'Write', items: [['continue', 'Continue writing']] },
  { label: 'Whole document', items: [['summarize', 'Summarize at the top'], ['actions', 'Extract action items'], ['contradictions', 'Find contradictions'], ['check', 'Check against decisions']] },
]

// The button in the selection toolbar. `data-ai-open` marks every control that opens the menu,
// so a click on one is not read as a click outside.
export function AskAiButton({ onOpen }: { onOpen: () => void }) {
  const Components = useComponentsContext()!
  return (
    <Components.FormattingToolbar.Button mainTooltip={`Ask ${NIB}`} label={`Ask ${NIB}`} onClick={onOpen}>
      <span className="ask-ai" data-ai-open><span aria-hidden="true">✦</span> Ask {NIB}</span>
    </Components.FormattingToolbar.Button>
  )
}

// "@nib" in the text: one item while what follows "@" could still be "nib". Whatever is typed after
// "nib " becomes the instruction, so "@nib write an intro" and Enter runs at once.
export const nibItems = (open: (instruction: string) => void) => async (query: string): Promise<DefaultReactSuggestionItem[]> => {
  const q = query.toLowerCase()
  if (!(q.startsWith('nib') ? q.length === 3 || q[3] === ' ' : 'nib'.startsWith(q))) return []
  const instruction = query.slice(4).trim()
  return [{ title: instruction ? `Ask ${NIB}: ${instruction}` : `Ask ${NIB}`, subtext: instruction ? 'Press Enter to send' : 'Type an instruction, or press Enter for the menu', onItemClick: () => open(instruction) }]
}

// Its menu: nothing at all when there is no match, so an "@" in an email address stays quiet.
export function NibSuggestion({ items, selectedIndex, onItemClick }: SuggestionMenuProps<DefaultReactSuggestionItem>) {
  if (!items.length) return null
  return (
    <div className="nib-at" role="listbox" id="bn-suggestion-menu">
      {items.map((item, i) => (
        <button key={item.title} type="button" role="option" id={`bn-suggestion-menu-item-${i}`} aria-selected={i === selectedIndex} onMouseDown={(e) => e.preventDefault()} onClick={() => onItemClick?.(item)}>
          <span className="nib-badge" aria-hidden="true">✦</span>
          <span><strong>{item.title}</strong><small>{item.subtext}</small></span>
        </button>
      ))}
    </div>
  )
}

// The Nib menu: next to the selected text (or under the header's Nib button) on a wide screen,
// a bottom sheet on a phone. The answer goes into the text as a suggestion by Nib, then the menu
// closes and the new suggestion is selected, so the bar offers Accept and Reject at once.
// "Check against decisions" is not an edit: it asks for Nib's check, whose result shows in the Outline panel.
export function AiMenu({ editor, documentId, start = '', onClose, onCheck }: { editor: Editor; documentId: string; start?: string; onClose: () => void; onCheck?: () => void }) {
  const view = editor.prosemirrorView!
  const [hasSelection] = useState(() => !view.state.selection.empty)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [instruction, setInstruction] = useState(start)
  const [pos, setPos] = useState<CSSProperties | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const menu = ref.current!
    if (matchMedia('(max-width: 600px)').matches) return setPos({}) // the CSS makes it a sheet
    const w = menu.offsetWidth, h = menu.offsetHeight
    const sel = view.state.selection
    // Next to the selection, or the cursor when "@nib" opened it; under the header button otherwise.
    const header = document.activeElement?.closest('.doc-tools')
    const at = header ? null : view.coordsAtPos(sel.to)
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

  // Escape or a click outside closes (not while Nib is working).
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
    if (command === 'check') { onClose(); onCheck?.(); return } // close first: the check opens the Outline panel
    const { from, to, $to } = view.state.selection
    // Rewrites send only the selection; "continue" sends the text before the cursor.
    const text = command === 'continue' ? view.state.doc.textBetween(0, $to.end(), '\n').slice(-4000) : view.state.doc.textBetween(from, to, '\n')
    setBusy(command); setError('')
    try {
      const res = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId, command, text, instruction }) })
      const out = await res.json().catch(() => ({})) as { text?: string; error?: string }
      if (!res.ok || !out.text) throw new Error(out.error ?? `${NIB} did not answer. Try again.`)
      const answer = out.text
      // List answers: one item per line, without bullets or numbers.
      const lines = answer.split('\n').map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim()).filter((l) => l && !/^none found\.?$/i.test(l))
      if ((command === 'actions' || command === 'contradictions') && !lines.length) throw new Error(command === 'actions' ? `${NIB} found no action items.` : `${NIB} found no contradictions.`)
      const before = new Set(readSuggestions(view.state).all.map((s) => s.id))
      const last = editor.document[editor.document.length - 1]
      // A free instruction may answer in Markdown: headings, lists, several paragraphs.
      const parsed = command === 'custom' ? editor.tryParseMarkdownToBlocks(answer) : []
      const selectedBlocks = editor.getSelection()?.blocks
      const here = selectedBlocks?.[selectedBlocks.length - 1] ?? editor.getTextCursorPosition().block
      suggestAs(view, 'ai', () => {
        const sel = view.state.selection
        const replace = command === 'improve' || command === 'fix' || command === 'shorten' || (command === 'custom' && !sel.empty && parsed.length <= 1 && parsed[0]?.type === 'paragraph')
        if (replace) view.dispatch(view.state.tr.insertText(command === 'custom' ? answer.replace(/\s*\n\s*/g, ' ') : answer, sel.from, sel.to))
        else if (command === 'custom') {
          if (!sel.empty) view.dispatch(view.state.tr.delete(sel.from, sel.to))
          editor.insertBlocks(parsed, here, 'after')
        }
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

  // "@nib <instruction>" and Enter: send it right away. Otherwise the field waits for one.
  useEffect(() => {
    if (start) run('custom')
    else input.current?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const send = () => { if (instruction.trim() && !busy) run('custom') }

  return (
    <>
      <div className="ai-scrim" aria-hidden="true" />
      <div ref={ref} className="ai-menu" role="dialog" aria-label={`Ask ${NIB}`} style={pos ?? { visibility: 'hidden' }}>
        <div className="ai-menu-head">
          <span className="ai-mark" aria-hidden="true">✦</span>
          <strong>{NIB}</strong>
          <span className="muted small">{busy ? 'Writing…' : 'Answers arrive as suggestions'}</span>
        </div>
        <form className="ai-ask" onSubmit={(e) => { e.preventDefault(); send() }}>
          <textarea ref={input} rows={1} value={instruction} maxLength={500} disabled={!!busy} aria-label={`Instruction for ${NIB}`}
            placeholder={hasSelection ? 'Tell Nib what to do with the selection…' : 'Tell Nib what to write…'}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
          <button type="submit" className="primary ai-send" disabled={!instruction.trim() || !!busy} aria-busy={busy === 'custom'} aria-label="Send">
            {busy === 'custom' ? <span className="spinner" aria-hidden="true" /> : '↑'}
          </button>
        </form>
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
