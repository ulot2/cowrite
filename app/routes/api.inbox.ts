import { requireUser } from '~/lib/auth.server'
import { countUnseen, listInbox, markSeen, seenAt } from '~/lib/events.server'
import type { Route } from './+types/api.inbox'

// The bell's data: how many events since the bell was last opened, and the newest twenty.
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const since = await seenAt(user.id)
  return { since, unseen: await countUnseen(user.id, since), events: await listInbox(user.id) }
}

// Opening the bell marks everything seen.
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request)
  await markSeen(user.id)
  return { ok: true }
}
