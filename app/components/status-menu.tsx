import { useFetcher } from 'react-router'
import { atLeast, type Role } from '~/lib/roles'
import { canMove, moves, statusLabel, type Move, type Status } from '~/lib/status'

// The status pill. Opens a native <details> menu with the moves this person may make from here.
// A refused move (an open concern, a stale page) says why.
export function StatusMenu({ status, role }: { status: Status; role: Role }) {
  const fetcher = useFetcher<{ error?: string } | null>()
  const allowed = (Object.keys(moves) as Move[]).filter((m) => canMove(m, status) && atLeast(role, moves[m].need))
  if (allowed.length === 0) return <span className="status" data-status={status}>{statusLabel[status]}</span>
  // The menu closes on a pick, so a refusal shows beside the pill, not inside the menu.
  return (
    <>
    <details className="status-menu">
      <summary className="status" data-status={status} aria-label={`Status: ${statusLabel[status]}. Change it`}>{statusLabel[status]}</summary>
      <fetcher.Form method="post" className="popover">
        <input type="hidden" name="intent" value="status" />
        {allowed.map((m) => <button key={m} className="ghost" name="move" value={m} disabled={fetcher.state !== 'idle'}>{moves[m].label}</button>)}
      </fetcher.Form>
    </details>
    {fetcher.state === 'idle' && fetcher.data?.error && <p className="status-error" role="alert">{fetcher.data.error}</p>}
    </>
  )
}
