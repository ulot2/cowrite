import { createContext, useContext, useRef } from 'react'
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems, insertOrUpdateBlockForSlashMenu, type BlockNoteEditor } from '@blocknote/core'
import { createReactBlockSpec, getDefaultReactSlashMenuItems, useBlockNoteEditor, useComponentsContext, useEditorState, type DefaultReactSuggestionItem } from '@blocknote/react'
import { Select } from './select'
import { Avatar } from './avatar'
import { Icon } from './icon'
import { colorFor } from '~/lib/color'
import type { Person } from './mentions.client'

// The document's members, for the task's assignee picker. Provided by the rich editor.
export const People = createContext<Person[]>([])

const newId = () => crypto.randomUUID()

// "Oct 1", "Today", "Tomorrow"; and whether a date has passed.
const today = () => new Date().toISOString().slice(0, 10)
const dayLabel = (iso: string) => {
  const t = today(), tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10)
  if (iso === t) return 'Today'
  if (iso === tomorrow) return 'Tomorrow'
  return new Date(iso + 'T00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

// The due date as a chip. The real date field sits under it, and a click opens the browser's picker.
function DueChip({ due, done, editable, onChange }: { due: string; done: boolean; editable: boolean; onChange: (v: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const late = !!due && !done && due < today()
  return (
    <span className="chip due-chip" data-late={late || undefined} data-empty={!due || undefined}>
      <Icon name="calendar" />
      <span>{due ? (late ? `Due ${dayLabel(due)} · late` : `Due ${dayLabel(due)}`) : 'Add date'}</span>
      <input ref={input} type="date" value={due} disabled={!editable} aria-label={due ? `Due date, ${dayLabel(due)}` : 'Due date'}
        onChange={(e) => onChange(e.target.value)} onClick={(e) => { try { e.currentTarget.showPicker() } catch { /* older browsers open it themselves */ } }} />
      {due && editable && <button type="button" className="chip-clear" aria-label="Remove the due date" onClick={() => onChange('')}><Icon name="close" /></button>}
    </span>
  )
}

// A task inside the text: a round tick, the words, who, and when. The document is its source; the
// Tasks page reads an index of it and ticks it back here. ponytail: a pasted copy keeps the same id.
const Task = createReactBlockSpec(
  { type: 'task', propSchema: { taskId: { default: '' }, assignee: { default: '' }, assigneeName: { default: '' }, due: { default: '' }, done: { default: false } }, content: 'inline' },
  {
    render: ({ block, editor, contentRef }) => {
      const people = useContext(People)
      const editable = editor.isEditable
      const set = (props: Partial<typeof block.props>) => editor.updateBlock(block, { props })
      const { assignee, assigneeName, due, done } = block.props
      return (
        <div className="task-block" data-done={done || undefined}>
          <button type="button" className="task-tick" contentEditable={false} disabled={!editable} aria-pressed={done}
            aria-label={done ? 'Mark as not done' : 'Mark as done'} onClick={() => set({ done: !done })}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
          </button>
          <div className="task-text" ref={contentRef} data-placeholder="Describe the task" />
          <span className="task-meta" contentEditable={false}>
            <span className="chip person-chip" data-empty={!assignee || undefined}>
              {assignee ? <Avatar name={assigneeName || '?'} color={colorFor(assignee)} size={18} /> : <Icon name="user" />}
              <Select key={assignee} name="assignee" label="Assigned to" className="quiet" disabled={!editable} defaultValue={assignee}
                options={[{ value: '', label: 'Assign' }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
                onChange={(v) => set({ assignee: v, assigneeName: people.find((p) => p.id === v)?.name ?? '' })} />
            </span>
            <DueChip due={due} done={done} editable={editable} onChange={(v) => set({ due: v })} />
          </span>
        </div>
      )
    },
  },
)

const statuses = [
  { value: 'proposed', label: 'Proposed', hint: 'Still open' },
  { value: 'decided', label: 'Decided', hint: 'We agreed' },
  { value: 'dropped', label: 'Dropped', hint: 'Not doing it' },
]

// A decision: a card with its number (D-12, given per space by the index), a status, and the words.
const Decision = createReactBlockSpec(
  { type: 'decision', propSchema: { decisionId: { default: '' }, status: { default: 'proposed' }, number: { default: 0 } }, content: 'inline' },
  {
    render: ({ block, editor, contentRef }) => (
      <div className="decision-block" data-status={block.props.status}>
        <span className="decision-head" contentEditable={false}>
          <span className="decision-mark" aria-hidden="true">◆</span>
          <span className="decision-label">{block.props.number ? `Decision D-${block.props.number}` : 'Decision'}</span>
          <span className="decision-status">
            <Select key={block.props.status} name="status" label="Decision status" className="quiet" disabled={!editor.isEditable} defaultValue={block.props.status} options={statuses}
              onChange={(v) => editor.updateBlock(block, { props: { status: v } })} />
          </span>
        </span>
        <div className="decision-text" ref={contentRef} data-placeholder="What was decided, in one sentence?" />
      </div>
    ),
  },
)

export const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, task: Task(), decision: Decision() } })
type Editor = BlockNoteEditor<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>

// The slash menu: the library's items plus Task and Decision.
export const slashItems = (editor: Editor) => async (query: string) => filterSuggestionItems<DefaultReactSuggestionItem>([
  ...getDefaultReactSlashMenuItems(editor),
  { title: 'Task', subtext: 'A to-do with an owner and a date', aliases: ['todo', 'action'], group: 'Work', icon: <span aria-hidden="true">☐</span>,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'task', props: { taskId: newId() } }) },
  { title: 'Decision', subtext: 'Record what was decided, numbered', aliases: ['decide', 'adr'], group: 'Work', icon: <span aria-hidden="true">◆</span>,
    onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'decision', props: { decisionId: newId() } }) },
], query)

// "Turn into task" in the formatting toolbar: the block under the selection becomes a task.
export function TurnIntoTask() {
  const editor = useBlockNoteEditor(schema)
  const Components = useComponentsContext()!
  const block = useEditorState({ editor, selector: ({ editor }) => editor.getTextCursorPosition().block })
  if (!editor.isEditable || block.type === 'task' || !('content' in block) || !Array.isArray(block.content)) return null
  return (
    <Components.FormattingToolbar.Button mainTooltip="Turn into task" label="Turn into task" onClick={() => editor.updateBlock(block, { type: 'task', props: { taskId: newId() } })}>
      <span aria-hidden="true">☐</span>
    </Components.FormattingToolbar.Button>
  )
}
