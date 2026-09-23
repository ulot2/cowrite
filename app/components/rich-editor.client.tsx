import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFetcher } from 'react-router'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { createUserStore } from '@blocknote/core'
import { CommentsExtension, DefaultThreadStoreAuth } from '@blocknote/core/comments'
import { withCollaboration, YjsThreadStore } from '@blocknote/core/yjs'
import { BlockNoteViewEditor, ComponentsContext, FloatingComposerController, FloatingThreadController, FormattingToolbar, FormattingToolbarController, getFormattingToolbarItems, SuggestionMenuController, ThreadsSidebar, useCreateBlockNote } from '@blocknote/react'
import { People, schema, slashItems, TurnIntoTask } from './blocks.client'
import { AiMenu, AskAiButton, NIB, nibItems, NibSuggestion } from './ai-menu.client'
import { BlockNoteView } from '@blocknote/mantine'
import { commentSchema, componentsWithMentions, type Person } from './mentions.client'
import { selectSuggestion } from '@handlewithcare/prosemirror-suggest-changes'
import { applySuggestion, applySuggestions, disableSuggestChanges, enableSuggestChanges, readSuggestions, revertSuggestion, revertSuggestions, SuggestionsExtension, type SuggestionInfo } from './suggestions.client'

export type Panel = 'none' | 'open' | 'resolved' | 'outline' | 'ai'
export type ConnectionState = 'connected' | 'connecting' | 'disconnected'
export type Presence = { name: string; color: string; editing?: boolean }
type Props = {
  documentId: string
  user: { id: string; name: string; color: string }
  canEdit: boolean
  canComment: boolean
  // Suggest mode: edits become suggestions. `canResolve` is who may accept or reject.
  suggesting: boolean
  canResolve: boolean
  people: Person[] // members, for @mentions in comments
  panel: Panel
  onPanel: (panel: Panel) => void
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
export function RichEditor({ documentId, user, canEdit, canComment, suggesting, canResolve, people, panel, onPanel, onStatus }: Props) {
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
  const step = (dir: 1 | -1) => {
    if (!found.all.length) return
    const i = found.all.findIndex((s) => s.id === found.atCursor?.id)
    const next = found.all[(i + dir + found.all.length) % found.all.length]
    run(selectSuggestion(next.id))
    editor.prosemirrorView?.dispatch(editor.prosemirrorState.tr.scrollIntoView())
    editor.focus()
  }

  // The outline: the document's headings, live. A click puts the cursor there and scrolls to it.
  const [headings, setHeadings] = useState<{ id: string; level: number; text: string }[]>([])
  useEffect(() => {
    if (panel !== 'outline') return
    const read = () => {
      const out: { id: string; level: number; text: string }[] = []
      const walk = (blocks: typeof editor.document) => blocks.forEach((b) => {
        if (b.type === 'heading') out.push({ id: b.id, level: Number((b.props as { level?: number }).level ?? 1), text: (b.content as { text?: string }[]).map((c) => c.text ?? '').join('') })
        walk(b.children)
      })
      walk(editor.document)
      setHeadings(out)
    }
    read()
    return editor.onChange(read)
  }, [editor, panel])
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
  const uiComponents = useMemo(() => componentsWithMentions([...people, { id: 'ai', name: NIB }]), [people])
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    const missing = [...new Set(found.all.map((s) => s.author))].filter((id) => id !== 'ai' && !(id in names))
    if (missing.length) users.loadUsers(missing).then(() => setNames((n) => ({ ...n, ...Object.fromEntries(missing.map((id) => [id, users.getUser(id)?.username ?? 'someone'])) })))
  }, [found, names])

  return (
    <BlockNoteView editor={editor} editable={canEdit} comments={false} slashMenu={false} formattingToolbar={false} theme={useTheme()} renderEditor={false}>
      <People.Provider value={people}>
      <SuggestionMenuController triggerCharacter="/" getItems={slashItems(editor)} />
      <FormattingToolbarController formattingToolbar={() => <FormattingToolbar>{canEdit && <AskAiButton onOpen={() => onPanel('ai')} />}{getFormattingToolbarItems()}<TurnIntoTask /></FormattingToolbar>} />
      {canEdit && <SuggestionMenuController triggerCharacter="@" getItems={nibItems(openNib)} suggestionMenuComponent={NibSuggestion} />}
      {panel === 'ai' && canEdit && <AiMenu editor={editor} documentId={documentId} start={nibStart} onClose={closeAi} />}
      {/* Our components (the comment editor with @mentions) must wrap the comment UI, so the
          floating composer and thread are rendered here instead of by the view. */}
      <ComponentsContext.Provider value={uiComponents}>
      {canComment && <><FloatingComposerController /><FloatingThreadController /></>}
      <div className="editor-layout" data-panel={panel} ref={root}>
        <div className="editor-column">
          {found.all.length > 0 && (
            <div className="suggestion-bar" role="status">
              <span>{found.all.length === 1 ? '1 suggestion' : `${found.all.length} suggestions`}{found.atCursor && <> · by <strong>{nameOf(found.atCursor.author)}</strong></>}</span>
              <span className="suggestion-actions">
                <button type="button" className="ghost" onClick={() => step(-1)} aria-label="Previous suggestion">↑</button>
                <button type="button" className="ghost" onClick={() => step(1)} aria-label="Next suggestion">↓</button>
              </span>
              {canResolve && (
                <span className="suggestion-actions">
                  {found.atCursor ? (
                    <>
                      <button type="button" className="ghost" onClick={() => resolve('accepted', found.atCursor)}>Accept</button>
                      <button type="button" className="ghost" onClick={() => resolve('rejected', found.atCursor)}>Reject</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="ghost" onClick={() => resolve('accepted', null)}>Accept all</button>
                      <button type="button" className="ghost" onClick={() => resolve('rejected', null)}>Reject all</button>
                    </>
                  )}
                </span>
              )}
            </div>
          )}
          <BlockNoteViewEditor />
          {hover && (
            <div className="suggestion-pop" style={{ top: hover.top, left: hover.left }} onMouseEnter={() => clearTimeout(leaveTimer.current)} onMouseLeave={() => setHover(null)}>
              <span>Suggested by <strong>{nameOf(hover.author)}</strong></span>
              {canResolve && <span className="suggestion-actions"><button type="button" className="ghost" onClick={() => resolve('accepted', hover)}>Accept</button><button type="button" className="ghost" onClick={() => resolve('rejected', hover)}>Reject</button></span>}
            </div>
          )}
        </div>
        {panel === 'outline' && (
          <aside className="comments-panel outline" aria-label="Outline">
            <div className="panel-head"><strong>Outline</strong><button type="button" className="ghost" onClick={() => onPanel('none')} aria-label="Close outline">✕</button></div>
            {headings.length === 0 ? <p className="muted small">No headings yet. Type # and a space at the start of a line to make one.</p> : (
              <ol>{headings.map((h) => <li key={h.id} data-level={h.level}><button type="button" className="ghost" onClick={() => goTo(h.id)}>{h.text || 'Untitled heading'}</button></li>)}</ol>
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
