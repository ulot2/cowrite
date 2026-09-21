import { Form } from 'react-router'
import { atLeast, type Role } from '~/lib/roles'
import { moves, statusLabel, type Move, type Status } from '~/lib/status'

// The status pill. Opens a native <details> menu with the moves this person may make from here.
export function StatusMenu({ status, role }: { status: Status; role: Role }) {
  const allowed = (Object.keys(moves) as Move[]).filter((m) => moves[m].from === status && atLeast(role, moves[m].need))
  if (allowed.length === 0) return <span className="status" data-status={status}>{statusLabel[status]}</span>
  return (
    <details className="status-menu">
      <summary className="status" data-status={status} aria-label={`Status: ${statusLabel[status]}. Change it`}>{statusLabel[status]}</summary>
      <Form method="post" className="popover">
        <input type="hidden" name="intent" value="status" />
        {allowed.map((m) => <button key={m} className="ghost" name="move" value={m}>{moves[m].label}</button>)}
      </Form>
    </details>
  )
}
