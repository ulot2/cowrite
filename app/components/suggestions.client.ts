import { Extension, Mark, mergeAttributes } from '@tiptap/core'
import { createExtension } from '@blocknote/core'
import {
  applySuggestion, applySuggestions, disableSuggestChanges, enableSuggestChanges, isSuggestChangesEnabled,
  revertSuggestion, revertSuggestions, suggestChanges, suggestChangesKey, transformToSuggestionTransaction,
} from '@handlewithcare/prosemirror-suggest-changes'
import type { EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

export { applySuggestion, applySuggestions, disableSuggestChanges, enableSuggestChanges, isSuggestChangesEnabled, revertSuggestion, revertSuggestions }

// A suggestion id names its author: "<user id>~<random>". Ids from two people can never collide,
// and the bar can say who suggested without another attribute.
export const suggestionAuthor = (id: unknown) => String(id).split('~')[0]
let author: string | null = null // set by `suggestAs` while it runs
const idFor = (userId: string) => () => `${author ?? userId}~${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// Runs `edit` (synchronous editor calls) as suggestions by `by`, with suggest mode on or off.
export const suggestAs = (view: EditorView, by: string, edit: () => void) => {
  const was = isSuggestChangesEnabled(view.state)
  if (!was) enableSuggestChanges(view.state, view.dispatch)
  author = by
  try { edit() } finally {
    author = null
    if (!was) disableSuggestChanges(view.state, view.dispatch)
  }
}

// The three marks the library looks up by name. Two BlockNote groups: `annotation` keeps them out of
// its content model (they are not formatting, like the comment mark), `blockLevelSuggestion` lets a
// whole block carry one, so a new or removed paragraph is a suggestion like a word is.
const mark = (name: string, tag: string, excludes: string, extra: Record<string, { default: null; rendered: false }> = {}) =>
  Mark.create({
    name,
    inclusive: false,
    excludes,
    group: 'annotation blockLevelSuggestion',
    extendMarkSchema: (ext) => (ext.name === name ? { blocknoteIgnore: true } : {}),
    addAttributes: () => ({ id: { default: null, parseHTML: (el: HTMLElement) => el.dataset.id, renderHTML: (a) => ({ 'data-id': a.id }) }, ...extra }),
    parseHTML: () => [{ tag: `${tag}[data-id]` }],
    renderHTML: ({ HTMLAttributes }) => [tag, mergeAttributes(HTMLAttributes, { 'data-suggestion': name }), 0],
  })
const insertion = mark('insertion', 'ins', 'deletion modification insertion')
const deletion = mark('deletion', 'del', 'insertion modification deletion')
const modification = mark('modification', 'span', 'deletion insertion', { type: { default: null, rendered: false }, attrName: { default: null, rendered: false }, previousValue: { default: null, rendered: false }, newValue: { default: null, rendered: false } })

// While suggest mode is on, every local edit becomes marks instead of a change. Remote edits
// (y-prosemirror sets isChangeOrigin), undo, and anything flagged "skip" pass through untouched.
const suggestDispatch = (userId: string) => Extension.create({
  name: 'suggestDispatch',
  dispatchTransaction({ transaction, next }) {
    const state = this.editor.state
    const ySync = transaction.getMeta('y-sync$') ?? {}
    const track = isSuggestChangesEnabled(state) && transaction.docChanged && !transaction.getMeta('history$')
      && !ySync.isUndoRedoOperation && !ySync.isChangeOrigin && !('skip' in (transaction.getMeta(suggestChangesKey) ?? {}))
    next(track ? transformToSuggestionTransaction(transaction, state, idFor(userId)) : transaction)
  },
})

export const SuggestionsExtension = (userId: string) => createExtension({
  key: 'suggestions',
  tiptapExtensions: [insertion, deletion, modification, suggestDispatch(userId)],
  prosemirrorPlugins: [suggestChanges()],
})

export type SuggestionInfo = { id: string; author: string }

// Every suggestion in the document (one entry per id) and the one under the cursor, if any.
export const readSuggestions = (state: EditorState): { all: SuggestionInfo[]; atCursor: SuggestionInfo | null } => {
  const names = new Set(['insertion', 'deletion', 'modification'])
  const ids = new Map<string, SuggestionInfo>()
  state.doc.descendants((node) => {
    for (const m of node.marks) if (names.has(m.type.name) && m.attrs.id != null) ids.set(String(m.attrs.id), { id: String(m.attrs.id), author: suggestionAuthor(m.attrs.id) })
  })
  const $from = state.selection.$from
  const here = [...$from.marks(), ...($from.nodeAfter?.marks ?? []), ...$from.node().marks].find((m) => names.has(m.type.name) && m.attrs.id != null)
  return { all: [...ids.values()], atCursor: here ? { id: String(here.attrs.id), author: suggestionAuthor(here.attrs.id) } : null }
}
