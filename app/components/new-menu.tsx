import { Form, Link } from 'react-router'
import { Icon } from './icon'

const modes = [
  { mode: 'write', title: 'Write', text: 'An empty document' },
  { mode: 'brainstorm', title: 'Brainstorm', text: 'A board of cards, with votes' },
  { mode: 'plan', title: 'Plan', text: 'Goal, tasks, decisions, timeline' },
] as const

// "New": the four ways to start. Three make a document; Review opens the queue of documents
// waiting for you. `action` is where the form posts: Home by default, "" for the current page (a space).
export function NewMenu({ action = '/?index' }: { action?: string }) {
  return (
    <details className="status-menu new-menu">
      <summary className="button primary"><Icon name="plus" />New</summary>
      <Form method="post" action={action || undefined} className="popover new-list">
        <input type="hidden" name="intent" value="create" />
        {modes.map((m) => (
          <button key={m.mode} className="ghost" name="mode" value={m.mode}>
            <Icon name={m.mode === 'write' ? 'docs' : m.mode === 'brainstorm' ? 'board' : 'plan'} />
            <span><strong>{m.title}</strong><small>{m.text}</small></span>
          </button>
        ))}
        <Link to="/review" className="button ghost">
          <Icon name="suggest" />
          <span><strong>Review</strong><small>Documents waiting for you</small></span>
        </Link>
      </Form>
    </details>
  )
}
