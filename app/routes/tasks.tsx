import { Link, useFetcher } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { roleOnDocument, roleOnSpace } from '~/lib/access.server'
import { getTask, listTasks, setTaskDone, type TaskRow } from '~/lib/work.server'
import { logEvent, logSpaceEvent } from '~/lib/events.server'
import { docStub } from '~/lib/versions.server'
import { atLeast } from '~/lib/roles'
import { Icon } from '~/components/icon'
import type { Route } from './+types/tasks'

export const meta = () => [{ title: 'Tasks · cowrite' }]

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const tasks = await listTasks(user.id)
  return { mine: tasks.filter((t) => t.assignee_id === user.id), others: tasks.filter((t) => t.assignee_id !== user.id) }
}

// Ticking a task here changes the block in its document (over RPC), so open editors tick too.
// Editors may tick any task; the person a task is assigned to may tick theirs.
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request)
  const f = await request.formData()
  const task = await getTask(String(f.get('id')))
  // A discussion task lives in its space's room; commenters there wrote it, so they may tick it.
  const inSpace = !!(task?.discussion_id && task.space_id)
  const role = task && (inSpace ? await roleOnSpace(user.id, task.space_id!) : await roleOnDocument(user.id, task.document_id))
  if (!task || !role) throw new Response('Not found', { status: 404 })
  if (!atLeast(role, inSpace ? 'commenter' : 'editor') && task.assignee_id !== user.id) throw new Response('Only editors and the assignee can tick a task', { status: 403 })
  const done = f.get('done') === 'true'
  if (!(await docStub(inSpace ? `${task.space_id}:space` : task.document_id).setTask(task.id, { done }))) throw new Response('Not found', { status: 404 })
  await setTaskDone(task.id, done)
  const text = `completed “${task.text.slice(0, 80)}”`
  if (done) await (inSpace ? logSpaceEvent(task.space_id!, user.id, 'task', text) : logEvent(task.document_id, user.id, 'task', text))
  return null
}

// Overdue, this week, later, no date, done: the order people plan in.
const today = () => new Date().toISOString().slice(0, 10)
const inAWeek = () => new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
const groups = (tasks: TaskRow[]) => {
  const t = today(), w = inAWeek()
  return [
    ['Overdue', tasks.filter((x) => !x.done && x.due && x.due < t)],
    ['This week', tasks.filter((x) => !x.done && x.due && x.due >= t && x.due <= w)],
    ['Later', tasks.filter((x) => !x.done && x.due && x.due > w)],
    ['No date', tasks.filter((x) => !x.done && !x.due)],
    ['Done', tasks.filter((x) => x.done)],
  ] as const
}

function TaskItem({ task }: { task: TaskRow }) {
  const fetcher = useFetcher()
  // Show the new state at once; the server confirms a moment later.
  const done = fetcher.formData ? fetcher.formData.get('done') === 'true' : !!task.done
  return (
    <li className="task-row" data-done={done || undefined} data-overdue={(!done && task.due && task.due < today()) || undefined}>
      <fetcher.Form method="post">
        <input type="hidden" name="id" value={task.id} />
        <button className="task-tick" name="done" value={String(!done)} aria-label={done ? `Mark “${task.text}” as not done` : `Mark “${task.text}” as done`} aria-pressed={done}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
        </button>
      </fetcher.Form>
      <span className="task-row-text">{task.text || 'Untitled task'}</span>
      <Link to={task.discussion_id ? `/space/${task.space_id}?tab=discussions&d=${task.discussion_id}` : `/doc/${task.document_id}`} className="task-row-doc">{task.discussion_id && <Icon name="comment" />}{task.title}</Link>
      {task.due && <time dateTime={task.due} className="task-row-due">{new Date(task.due + 'T00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })}</time>}
    </li>
  )
}

function Section({ title, tasks, empty }: { title: string; tasks: TaskRow[]; empty: string }) {
  return (
    <section className="task-section" aria-labelledby={`${title}-h`}>
      <h2 id={`${title}-h`}>{title} <span className="muted">{tasks.filter((t) => !t.done).length}</span></h2>
      {tasks.length === 0 ? <p className="muted">{empty}</p> : groups(tasks).map(([name, list]) => list.length > 0 && (
        <div key={name} className="task-group">
          <h3>{name}</h3>
          <ul>{list.map((t) => <TaskItem key={t.id} task={t} />)}</ul>
        </div>
      ))}
    </section>
  )
}

export default function Tasks({ loaderData }: Route.ComponentProps) {
  return (
    <div className="page tasks-page">
      <header className="page-title">
        <p className="eyebrow">Work</p>
        <h1>Tasks</h1>
        <p className="muted">Every task from your documents and your spaces’ discussions. Type <kbd>/task</kbd> in a document, or make one from a message in a discussion.</p>
      </header>
      <Section title="Assigned to me" tasks={loaderData.mine} empty="Nothing assigned to you." />
      <Section title="In my documents and spaces" tasks={loaderData.others} empty="No other tasks yet." />
    </div>
  )
}
