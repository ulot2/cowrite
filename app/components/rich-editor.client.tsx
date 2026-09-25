import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useFetcher } from 'react-router'
import { timeAgo } from '~/lib/time'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { createUserStore } from '@blocknote/core'
import { CommentsExtension, DefaultThreadStoreAuth } from '@blocknote/core/comments'
import { withCollaboration, YjsThreadStore } from '@blocknote/core/yjs'
import { BlockNoteViewEditor, ComponentsContext, FloatingComposerController, FloatingThreadController, FormattingToolbar, FormattingToolbarController, getFormattingToolbarItems, SuggestionMenuController, ThreadsSidebar, useCreateBlockNote } from '@blocknote/react'
import { People, schema, slashItems, TurnIntoTask } from './blocks.client'
import { Icon } from './icon'
import { Avatar } from './avatar'
import { AiMenu, AskAiButton, NIB, nibItems, NibSuggestion } from './ai-menu.client'
import { BlockNoteView } from '@blocknote/mantine'
import { commentSchema, componentsWithMentions, type Person } from './mentions.client'
import { selectSuggestion } from '@handlewithcare/prosemirror-suggest-changes'
import { applySuggestion, applySuggestions, disableSuggestChanges, enableSuggestChanges, readSuggestions, revertSuggestion, revertSuggestions, SuggestionsExtension, type SuggestionInfo } from './suggestions.client'

export type Panel = 'none' | 'open' | 'resolved' | 'outline' | 'ai'
export type ConnectionState = 'connected' | 'connecting' | 'disconnected'
export type Presence = { name: string; color: string; editing?: boolean }
export type Signoff = { block_id: string; user_id: string; name: string; state: 'agree' | 'concern'; note: string; heading: string; text_hash: string }
// While a document is in review: every sign-off, and whether this person may sign.
export type Review = { signoffs: Signoff[]; canSign: boolean }
// Nib's latest check of the document against the decisions in force and the open questions.
export type Check = { state: 'pending' | 'done' | 'failed'; at: number | null; findings: { kind: 'decision' | 'question'; text: string; href: string }[] }
type Props = {
  documentId: string
  user: { id: string; name: string; color: string }
  canEdit: boolean
  canComment: boolean
  // Suggest mode: edits become suggestions. `canResolve` is who may accept or reject.
  suggesting: boolean
  canResolve: boolean
  nib: boolean // Nib is on in this person's settings
  people: Person[] // members, for @mentions in comments
  panel: Panel
  onPanel: (panel: Panel) => void
  onStatus: (state: ConnectionState, others: Presence[], openComments: number) => void
  review?: Review
  check?: Check | null
  onCheck?: () => void // asks for a new check; absent when this person cannot
  onSections?: (total: number, signed: number, concerns: number) => void
}

// A short hash of a section's text (FNV-1a), to tell when it changed after a sign-off.
const hash = (text: string) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193); return (h >>> 0).toString(36) }

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
export function RichEditor({ documentId, user, canEdit, canComment, suggesting, canResolve, nib, people, panel, onPanel, onStatus, review, check, onCheck, onSections }: Props) {
  const canNib = canEdit && nib
  const [sync] = useState(() => {
    // Same origin. /ws/<id> carries the text, /ws/<id>/threads the comments: two rooms, so the
    // server can let a commenter write comments and still refuse their edits to the text.
    // disableBc: tabs must not relay presence to each other; the server owns it.
    // connect: false. React (in development) runs this initializer twice and keeps one result;
    // a socket opened here would leak. The effect below connects, and disconnects on unmount.
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    const doc = new Y.Doc()
    const provider = new WebsocketProvider(url, documentId, doc, { disableBc: true, connect: false })
    provider.awareness.setLocalStateField('user', { name: user.name, color: user.color })
    const threadsDoc = new Y.Doc()
    const threadsProvider = new WebsocketProvider(url, `${documentId}/threads`, threadsDoc, { disableBc: true, connect: false })
    const threads = threadsDoc.getMap('threads')
    const threadStore = new YjsThreadStore(user.id, threads, new DefaultThreadStoreAuth(user.id, canComment ? 'editor' : 'comment'))
    return { doc, provider, threadsDoc, threadsProvider, threads, threadStore }
  })

  // The destroy waits one tick: a real unmount still frees everything, and the development
  // mount-unmount-mount does not kill the provider we keep.
  const destroyTimer = useRef<number>(undefined)
  // Open and resolved counts, for the empty line in the panel.
  const [counts, setCounts] = useState({ open: 0, resolved: 0 })
  useEffect(() => {
    clearTimeout(destroyTimer.current)
    const { doc, provider, threadsDoc, threadsProvider, threads } = sync
    provider.connect()
    threadsProvider.connect()
    const report = () => {
      // Read the state, do not track events: the socket can open before this listener exists.
      const state: ConnectionState = provider.wsconnected ? 'connected' : provider.shouldConnect ? 'connecting' : 'disconnected'
      // Everyone else in the document. `cursor` is set by the editor while a selection is in the text.
      const others = [...provider.awareness.getStates()].filter(([id]) => id !== doc.clientID)
        .map(([, s]) => s.user && { ...s.user, editing: s.cursor != null }).filter(Boolean)
      const open = [...threads.values()].filter((t) => (t as Y.Map<unknown>).get('resolved') !== true).length
      setCounts({ open, resolved: threads.size - open })
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
      threadsProvider.disconnect()
      destroyTimer.current = window.setTimeout(() => { provider.destroy(); doc.destroy(); threadsProvider.destroy(); threadsDoc.destroy() }, 0)
    }
  }, [sync, onStatus])

  const editor = useCreateBlockNote(withCollaboration({
    schema,
    uploadFile,
    domAttributes: { editor: { 'aria-label': 'Document text' } },
    extensions: [CommentsExtension({ threadStore: sync.threadStore, resolveUsers: users, schema: commentSchema }), SuggestionsExtension(user.id)],
    collaboration: {
      provider: sync.provider,
      fragment: sync.doc.getXmlFragment('document-store'),
      user: { name: user.name, color: user.color },
      showCursorLabels: 'always',
    },
  }), [sync])

  const root = useRef<HTMLDivElement>(null)
  useActionLabels(root)

  // Suggest mode follows the prop. The plugin state lives in ProseMirror, so set it through its commands.
  useEffect(() => {
    const view = editor.prosemirrorView
    if (!view) return
    ;(suggesting ? enableSuggestChanges : disableSuggestChanges)(view.state, view.dispatch)
  }, [editor, suggesting])

  // What the bar shows: every suggestion in the text, and the one under the cursor.
  const [found, setFound] = useState<{ all: SuggestionInfo[]; atCursor: SuggestionInfo | null }>({ all: [], atCursor: null })
  useEffect(() => {
    const update = () => setFound(readSuggestions(editor.prosemirrorState))
    const offChange = editor.onChange(update)
    const offSelect = editor.onSelectionChange(update)
    update()
    return () => { offChange(); offSelect() }
  }, [editor])
  const run = (command: (state: import('prosemirror-state').EditorState, dispatch: (tr: import('prosemirror-state').Transaction) => void) => boolean) => {
    const view = editor.prosemirrorView
    if (view) command(view.state, view.dispatch)
  }
  // Accepting or rejecting is logged, so the author hears about it through the bell.
  const log = useFetcher()
  const resolve = (outcome: 'accepted' | 'rejected', s: SuggestionInfo | null) => {
    if (s) run(outcome === 'accepted' ? applySuggestion(s.id) : revertSuggestion(s.id))
    else run(outcome === 'accepted' ? applySuggestions : revertSuggestions)
    log.submit({ intent: 'suggestion', outcome, author: s?.author ?? '' }, { method: 'post' })
    setHover(null)
  }

  // A small card at the mark under the mouse: who, and Accept / Reject. The bar does the same
  // for the keyboard. A short delay on leaving lets the mouse travel into the card.
  const [hover, setHover] = useState<(SuggestionInfo & { top: number; left: number }) | null>(null)
  const leaveTimer = useRef<number>(undefined)
  useEffect(() => {
    const el = root.current
    if (!el) return
    const over = (e: MouseEvent) => {
      const mark = (e.target as HTMLElement).closest<HTMLElement>('[data-suggestion][data-id]')
      if (!mark) return
      clearTimeout(leaveTimer.current)
      const box = el.getBoundingClientRect(), r = mark.getBoundingClientRect()
      const id = mark.dataset.id!
      setHover((h) => (h?.id === id ? h : { id, author: id.split('~')[0], top: r.bottom - box.top + 6, left: Math.max(0, r.left - box.left) }))
    }
    const out = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-suggestion], .suggestion-pop')) leaveTimer.current = window.setTimeout(() => setHover(null), 250)
    }
    el.addEventListener('mouseover', over)
    el.addEventListener('mouseout', out)
    return () => { el.removeEventListener('mouseover', over); el.removeEventListener('mouseout', out); clearTimeout(leaveTimer.current) }
  }, [])
  useEffect(() => { if (hover && !found.all.some((s) => s.id === hover.id)) setHover(null) }, [found, hover])
  // Previous / Next: select a suggestion and bring it into view.
  // With none selected yet, Next goes to the first and Previous to the last. The one selected is
  // outlined (see the style under the bar), so it shows without focus in the text, and it is
  // scrolled to the middle of the screen, above the phone panel.
  const step = (dir: 1 | -1) => {
    const n = found.all.length
    if (!n) return
    const i = found.all.findIndex((s) => s.id === found.atCursor?.id)
    const next = found.all[i < 0 ? (dir > 0 ? 0 : n - 1) : (i + dir + n) % n]
    run(selectSuggestion(next.id))
    root.current?.querySelector(`[data-suggestion][data-id="${CSS.escape(next.id)}"]`)
      ?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    if (!sheet) { editor.focus(); return } // on a phone, focus in the text would open the keyboard under the panel
    // In the panel, an arrow that just disabled itself would drop focus; Accept (or the next button) takes it.
    requestAnimationFrame(() => { if (!document.activeElement || (document.activeElement as HTMLButtonElement).disabled || document.activeElement === document.body) (sheetRef.current?.querySelector<HTMLButtonElement>('.suggestion-accept') ?? sheetRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus() })
  }

  // Phones: the bar waits behind a round button with the count, and opens as a panel from the
  // bottom. Tapping a suggestion in the text opens it too. It closes on a tap outside, a swipe down,
  // ×, or Escape, and hands focus back to the button. Desktop keeps the bar; CSS hides the rest.
  const [sheet, setSheet] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const closeSheet = useCallback(() => { setSheet(false); fabRef.current?.focus() }, [])
  useEffect(() => { if (!found.all.length) setSheet(false) }, [found.all.length])
  // While the panel is open, the text's formatting toolbar stays hidden (see app.css).
  useEffect(() => { document.documentElement.toggleAttribute('data-sheet', sheet); return () => { document.documentElement.removeAttribute('data-sheet') } }, [sheet])
  useEffect(() => { if (sheet) sheetRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus() }, [sheet])
  useEffect(() => {
    const el = root.current
    if (!el) return
    const tap = (e: MouseEvent) => { if ((e.target as HTMLElement).closest('[data-suggestion]') && matchMedia('(max-width: 600px)').matches) setSheet(true) }
    el.addEventListener('click', tap)
    return () => el.removeEventListener('click', tap)
  }, [])
  // The on-screen keyboard covers the bottom of the page; the button rides above it.
  const waiting = found.all.length > 0
  useEffect(() => {
    const vv = window.visualViewport
    if (!waiting || !vv) return
    const set = () => document.documentElement.style.setProperty('--keyboard', `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`)
    set()
    vv.addEventListener('resize', set)
    vv.addEventListener('scroll', set)
    return () => { vv.removeEventListener('resize', set); vv.removeEventListener('scroll', set); document.documentElement.style.removeProperty('--keyboard') }
  }, [waiting])
  // Inside the open panel: Escape closes, Tab stays among its buttons.
  const sheetKeys = (e: React.KeyboardEvent) => {
    if (!sheet) return
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return }
    if (e.key !== 'Tab') return
    const all = [...(sheetRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const first = all[0], last = all[all.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
  const swipeFrom = useRef(0)

  // The outline: the document's headings, live. A click puts the cursor there and scrolls to it.
  // In review, each heading is a section (it runs to the next heading of the same or a higher
  // level), with a hash of its text, so a sign-off can tell that the section changed since.
  const [headings, setHeadings] = useState<{ id: string; level: number; text: string; hash: string }[]>([])
  useEffect(() => {
    if (panel !== 'outline' && !review) return
    const read = () => {
      const flat: { id: string; heading: number; text: string }[] = []
      const words = (c: unknown) => Array.isArray(c) ? c.map((x: { text?: string }) => x.text ?? '').join('') : ''
      const walk = (blocks: typeof editor.document) => blocks.forEach((b) => {
        flat.push({ id: b.id, heading: b.type === 'heading' ? Number((b.props as { level?: number }).level ?? 1) : 0, text: words(b.content) })
        walk(b.children)
      })
      walk(editor.document)
      setHeadings(flat.flatMap((b, i) => {
        if (!b.heading) return []
        const end = flat.findIndex((x, j) => j > i && x.heading && x.heading <= b.heading)
        return [{ id: b.id, level: b.heading, text: b.text, hash: hash(flat.slice(i, end < 0 ? undefined : end).map((x) => x.text).join('\n')) }]
      }))
    }
    read()
    return editor.onChange(read)
  }, [editor, panel, review])
  // Per section: who agreed, who has a concern, and whether the text moved on since.
  const sections = headings.map((h) => {
    const rows = (review?.signoffs ?? []).filter((x) => x.block_id === h.id).map((x) => ({ ...x, stale: x.text_hash !== h.hash }))
    return { ...h, rows, mine: rows.find((x) => x.user_id === user.id), signed: rows.some((x) => x.state === 'agree' && !x.stale) && !rows.some((x) => x.state === 'concern') }
  })
  const orphans = (review?.signoffs ?? []).filter((x) => x.state === 'concern' && !headings.some((h) => h.id === x.block_id))
  const signedCount = sections.filter((x) => x.signed).length
  const concernCount = (review?.signoffs ?? []).filter((x) => x.state === 'concern').length
  useEffect(() => { if (review) onSections?.(headings.length, signedCount, concernCount) }, [review, onSections, headings.length, signedCount, concernCount])
  const sign = useFetcher()
  const [concerning, setConcerning] = useState<string | null>(null)
  const signOff = (h: { id: string; text: string; hash: string }, state: 'agree' | 'concern' | null, note = '') =>
    sign.submit(state ? { intent: 'signoff', block: h.id, heading: h.text, hash: h.hash, state, note } : { intent: 'unsignoff', block: h.id }, { method: 'post' })
  const colorOf = (id: string) => people.find((p) => p.id === id)?.color ?? 'var(--fg-muted)'
  const goTo = (id: string) => {
    editor.setTextCursorPosition(id, 'start')
    editor.focus()
    root.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  // Nib's menu. "@nib <instruction>" opens it with the instruction already given.
  const [nibStart, setNibStart] = useState('')
  const openNib = useCallback((instruction: string) => { setNibStart(instruction); onPanel('ai') }, [onPanel])
  const closeAi = useCallback(() => { setNibStart(''); onPanel('none') }, [onPanel])
  const nameOf = (author: string) => (author === user.id ? 'you' : author === 'ai' ? NIB : names[author] ?? '…')
  const uiComponents = useMemo(() => componentsWithMentions(nib ? [...people, { id: 'ai', name: NIB }] : people), [people, nib])
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    const missing = [...new Set(found.all.map((s) => s.author))].filter((id) => id !== 'ai' && !(id in names))
    if (missing.length) users.loadUsers(missing).then(() => setNames((n) => ({ ...n, ...Object.fromEntries(missing.map((id) => [id, users.getUser(id)?.username ?? 'someone'])) })))
  }, [found, names])

  return (
    <BlockNoteView editor={editor} editable={canEdit} comments={false} slashMenu={false} formattingToolbar={false} theme={useTheme()} renderEditor={false}>
      <People.Provider value={people}>
      <SuggestionMenuController triggerCharacter="/" getItems={slashItems(editor)} />
      <FormattingToolbarController formattingToolbar={() => <FormattingToolbar>{canNib && <AskAiButton onOpen={() => onPanel('ai')} />}{getFormattingToolbarItems()}<TurnIntoTask /></FormattingToolbar>} />
      {canNib && <SuggestionMenuController triggerCharacter="@" getItems={nibItems(openNib)} suggestionMenuComponent={NibSuggestion} />}
      {panel === 'ai' && canNib && <AiMenu editor={editor} documentId={documentId} start={nibStart} onClose={closeAi} onCheck={onCheck} />}
      {/* Our components (the comment editor with @mentions) must wrap the comment UI, so the
          floating composer and thread are rendered here instead of by the view. */}
      <ComponentsContext.Provider value={uiComponents}>
      {canComment && <><FloatingComposerController /><FloatingThreadController /></>}
      <div className="editor-layout" data-panel={panel} ref={root}>
        <div className="editor-column">
          {found.all.length > 0 && (() => {
            // "2 of 5" while the cursor is in one; the total otherwise. Accept is the one filled button.
            const at = found.atCursor ? found.all.findIndex((x) => x.id === found.atCursor!.id) + 1 : 0
            const one = found.atCursor
            const n = found.all.length
            const stuck = n === 1 && !!one // the only suggestion is already selected: nowhere to go
            return (
              <>
              {one && <style>{`.editor-layout [data-suggestion][data-id="${CSS.escape(one.id)}"] { outline: 2px solid var(--accent); outline-offset: 1px; border-radius: 3px; }`}</style>}
              <button type="button" ref={fabRef} className="suggestion-fab" aria-expanded={sheet} aria-controls="suggestion-bar" aria-label={`Suggestions, ${n} waiting`} onClick={() => setSheet(true)}>
                <Icon name="suggest" /><span className="suggestion-count" aria-hidden="true">{n}</span>
              </button>
              {sheet && <div className="suggestion-backdrop" onClick={closeSheet} />}
              <div id="suggestion-bar" ref={sheetRef} className="suggestion-bar" data-open={sheet || undefined} role={sheet ? 'dialog' : 'region'} aria-modal={sheet || undefined} aria-label="Suggestions"
                onKeyDown={sheetKeys} onTouchStart={(e) => { swipeFrom.current = e.touches[0].clientY }} onTouchEnd={(e) => { if (sheet && e.changedTouches[0].clientY - swipeFrom.current > 60) closeSheet() }}>
                <span className="suggestion-badge" aria-hidden="true"><Icon name={one?.author === 'ai' ? 'sparkle' : 'suggest'} /></span>
                <span className="suggestion-info" role="status">
                  <strong>{one ? `Suggestion ${at} of ${found.all.length}` : found.all.length === 1 ? '1 suggestion' : `${found.all.length} suggestions`}</strong>
                  <span>{one ? <>by {nameOf(one.author)}</> : canResolve ? 'Review them one by one, or all at once' : 'Waiting for an editor to review'}</span>
                </span>
                <span className="suggestion-nav">
                  <button type="button" className="ghost" onClick={() => step(-1)} disabled={stuck} aria-label="Previous suggestion" data-tip="Previous"><Icon name="chevron" /></button>
                  <button type="button" className="ghost" onClick={() => step(1)} disabled={stuck} aria-label="Next suggestion" data-tip="Next"><Icon name="chevron" /></button>
                </span>
                {canResolve && (
                  <span className="suggestion-actions">
                    <button type="button" className="suggestion-reject" onClick={() => resolve('rejected', one)}><Icon name="close" />{one ? 'Reject' : 'Reject all'}</button>
                    <button type="button" className="suggestion-accept" onClick={() => resolve('accepted', one)}><Icon name="check" />{one ? 'Accept' : 'Accept all'}</button>
                  </span>
                )}
                <button type="button" className="ghost suggestion-close" aria-label="Close suggestions" onClick={closeSheet}><Icon name="close" /></button>
              </div>
              </>
            )
          })()}
          <BlockNoteViewEditor />
          {hover && (
            <div className="suggestion-pop" style={{ top: hover.top, left: hover.left }} onMouseEnter={() => clearTimeout(leaveTimer.current)} onMouseLeave={() => setHover(null)}>
              <span>Suggested by <strong>{nameOf(hover.author)}</strong></span>
              {canResolve && <span className="suggestion-actions"><button type="button" className="suggestion-reject" onClick={() => resolve('rejected', hover)}><Icon name="close" />Reject</button><button type="button" className="suggestion-accept" onClick={() => resolve('accepted', hover)}><Icon name="check" />Accept</button></span>}
            </div>
          )}
        </div>
        {panel === 'outline' && (
          <aside className="comments-panel outline" aria-label="Outline">
            <div className="panel-head"><strong>{review ? 'Outline and sign-off' : 'Outline'}</strong><button type="button" className="ghost" onClick={() => onPanel('none')} aria-label="Close outline">✕</button></div>
            {(check || onCheck) && (
              <section className="nib-check" data-state={check?.state} data-found={(check?.state === 'done' && check.findings.length > 0) || undefined} aria-labelledby="nib-check-title">
                <div className="nib-check-head">
                  <span className="ai-mark" aria-hidden="true">✦</span><strong id="nib-check-title">Nib's check</strong>
                  {check?.at && check.state !== 'pending' && <span className="muted small">{timeAgo(check.at)}</span>}
                </div>
                {!check && <p className="small muted">Nib can compare this document with the decisions in force and the open questions.</p>}
                {check?.state === 'pending' && <p className="small" role="status"><span className="spinner" aria-hidden="true" /> Nib is checking this against the space…</p>}
                {check?.state === 'failed' && <p className="small" role="status">Nib could not check this. Try again later.</p>}
                {check?.state === 'done' && (check.findings.length === 0
                  ? <p className="small" role="status">No conflicts with the decisions in force or the open questions.</p>
                  : <ul className="nib-findings">{check.findings.map((f, i) => (
                      <li key={i} data-kind={f.kind}>{f.text} <Link to={f.href}>{f.kind === 'decision' ? 'Open the decision' : 'Open the question'}</Link></li>
                    ))}</ul>)}
                {onCheck && check?.state !== 'pending' && <button type="button" className="link-button" onClick={onCheck}>{check ? 'Check again' : 'Check against decisions'}</button>}
              </section>
            )}
            {review && headings.length > 0 && <p className="signoff-summary small" role="status">{signedCount} of {headings.length} {headings.length === 1 ? 'section' : 'sections'} signed{concernCount > 0 && <> · <span className="concern-text">{concernCount === 1 ? '1 concern' : `${concernCount} concerns`}</span></>}</p>}
            {headings.length === 0 ? <p className="muted small">{review ? 'Reviewers sign off each heading and the text under it. ' : ''}No headings yet. Type # and a space at the start of a line to make one.</p> : (
              <ol>{sections.map((h) => (
                <li key={h.id} data-level={h.level} data-signed={(review && h.signed) || undefined}>
                  <button type="button" className="ghost" onClick={() => goTo(h.id)}>{h.text || 'Untitled heading'}</button>
                  {review && (
                    <div className="signoff">
                      {h.rows.length > 0 && (
                        <ul className="signoff-people" aria-label="Sign-offs">
                          {h.rows.map((x) => (
                            <li key={x.user_id} data-state={x.state} data-stale={x.stale || undefined}
                              title={`${x.name}: ${x.state === 'agree' ? 'agrees' : 'has a concern'}${x.stale ? ' (the section changed since)' : ''}`}>
                              <Avatar name={x.name} color={colorOf(x.user_id)} size={20} />
                              <span className="sr-only">{x.state === 'agree' ? 'agrees' : 'has a concern'}{x.stale ? ', the section changed since' : ''}</span>
                              {x.state === 'concern' && <span className="signoff-note">{x.note || 'Concern'}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                      {review.canSign && (concerning === h.id ? (
                        <form className="concern-form" onSubmit={(e) => { e.preventDefault(); signOff(h, 'concern', String(new FormData(e.currentTarget).get('note') ?? '')); setConcerning(null) }}>
                          <textarea name="note" rows={2} maxLength={300} placeholder="What needs to change?" aria-label={`Your concern on “${h.text}”`} autoFocus />
                          <span className="form-actions"><button type="button" className="ghost" onClick={() => setConcerning(null)}>Cancel</button><button className="primary">Raise concern</button></span>
                        </form>
                      ) : (
                        <span className="signoff-actions">
                          {h.mine?.state === 'agree' && !h.mine.stale
                            ? <button type="button" className="ghost" aria-pressed="true" onClick={() => signOff(h, null)}><Icon name="check" />Agreed</button>
                            : <button type="button" className="ghost" onClick={() => signOff(h, 'agree')}><Icon name="check" />{h.mine?.state === 'agree' ? 'Agree again' : 'Agree'}</button>}
                          {h.mine?.state === 'concern'
                            ? <button type="button" className="ghost" onClick={() => signOff(h, null)}>Withdraw concern</button>
                            : <button type="button" className="ghost" onClick={() => setConcerning(h.id)}>Concern…</button>}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}</ol>
            )}
            {orphans.length > 0 && (
              <div className="signoff-orphans">
                <p className="small muted">Concerns on sections that are gone:</p>
                <ul>{orphans.map((x) => <li key={x.block_id + x.user_id}><strong>{x.name}</strong> on “{x.heading || 'a section'}”{x.note && `: ${x.note}`} {x.user_id === user.id && <button type="button" className="link-button" onClick={() => signOff({ id: x.block_id, text: x.heading, hash: '' }, null)}>Withdraw</button>}</li>)}</ul>
              </div>
            )}
          </aside>
        )}
        {(panel === 'open' || panel === 'resolved') && (
          <aside className="comments-panel" aria-label="Comments">
            <div className="panel-head">
              <div className="segmented" role="group" aria-label="Which comments">
                <button type="button" className={panel === 'open' ? 'on' : ''} aria-pressed={panel === 'open'} onClick={() => onPanel('open')}>Open</button>
                <button type="button" className={panel === 'resolved' ? 'on' : ''} aria-pressed={panel === 'resolved'} onClick={() => onPanel('resolved')}>Resolved</button>
              </div>
              <button type="button" className="ghost" onClick={() => onPanel('none')} aria-label="Close comments">✕</button>
            </div>
            {counts[panel] === 0 && <p className="muted small">{panel === 'open' ? (canComment ? 'No open comments. Select some text and use the comment button in the toolbar.' : 'No open comments.') : 'Nothing resolved yet.'}</p>}
            <ThreadsSidebar filter={panel} sort="position" />
          </aside>
        )}
      </div>
      </ComponentsContext.Provider>
      </People.Provider>
    </BlockNoteView>
  )
}
