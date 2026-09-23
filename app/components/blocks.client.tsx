import { createContext, useContext } from 'react'
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems, insertOrUpdateBlockForSlashMenu, type BlockNoteEditor } from '@blocknote/core'
import { createReactBlockSpec, getDefaultReactSlashMenuItems, useBlockNoteEditor, useComponentsContext, useEditorState, type DefaultReactSuggestionItem } from '@blocknote/react'
import { Select } from './select'
import type { Person } from './mentions.client'

// The document's members, for the task's assignee picker. Provided by the rich editor.
export const People = createContext<Person[]>([])

const newId = () => crypto.randomUUID()

// A task inside the text: a checkbox, the words, who, and when. The document is its source; the
// Tasks page reads an index of it and ticks it back here. ponytail: a pasted copy keeps the same id.
const Task = createReactBlockSpec(
  { type: 'task', propSchema: { taskId: { default: '' }, assignee: { default: '' }, assigneeName: { default: '' }, due: { default: '' }, done: { default: false } }, content: 'inline' },
  {
    render: ({ block, editor, contentRef }) => {
      const people = useContext(People)
      const editable = editor.isEditable
      const set = (props: Partial<typeof block.props>) => editor.updateBlock(block, { props })
      const { assignee, due, done } = block.props
      return (
        <div className="task-block" data-done={done || undefined}>
          <input type="checkbox" className="task-check" checked={done} disabled={!editable} onChange={(e) => set({ done: e.target.checked })} aria-label={done ? 'Mark as not done' : 'Mark as done'} contentEditable={false} />
          <div className="task-text" ref={contentRef} />
          <span className="task-meta" contentEditable={false}>
            <Select key={assignee} name="assignee" label="Assigned to" className="quiet" disabled={!editable} defaultValue={assignee}
              options={[{ value: '', label: 'No one' }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
              onChange={(v) => set({ assignee: v, assigneeName: people.find((p) => p.id === v)?.name ?? '' })} />
            <input type="date" className="task-due" value={due} disabled={!editable} aria-label="Due date" onChange={(e) => set({ due: e.target.value })} />
          </span>
        </div>
      )
    },
  },
)

const statuses = [{ value: 'proposed', label: 'Proposed' }, { value: 'decided', label: 'Decided' }, { value: 'dropped', label: 'Dropped' }]

// A decision: numbered per space by the index (D-12), with a status.
const Decision = createReactBlockSpec(
  { type: 'decision', propSchema: { decisionId: { default: '' }, status: { default: 'proposed' }, number: { default: 0 } }, content: 'inline' },
  {
    render: ({ block, editor, contentRef }) => (
      <div className="decision-block" data-status={block.props.status}>
        <span className="decision-head" contentEditable={false}>
          <strong>{block.props.number ? `D-${block.props.number}` : 'Decision'}</strong>
          <Select key={block.props.status} name="status" label="Decision status" className="quiet" disabled={!editor.isEditable} defaultValue={block.props.status} options={statuses}
            onChange={(v) => editor.updateBlock(block, { props: { status: v } })} />
        </span>
        <div className="decision-text" ref={contentRef} />
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
