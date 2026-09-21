import { redirect } from 'react-router'
import { getAuth } from '~/lib/auth.server'
import { findShareLink, redeemShareLink } from '~/lib/access.server'
import { logEvent, logSpaceEvent } from '~/lib/events.server'
import type { Route } from './+types/share'

// /s/<token>: following a share link. Signed out people go through login and come back here.
export async function loader({ request, params }: Route.LoaderArgs) {
  const session = await getAuth().api.getSession({ headers: request.headers })
  if (!session) throw redirect(`/login?next=${encodeURIComponent(`/s/${params.token}`)}`)
  const link = await findShareLink(params.token)
  if (!link) throw new Response('This link is no longer valid', { status: 404 })
  if (await redeemShareLink(link, session.user.id)) {
    const text = `joined through a link as ${link.role}`
    await (link.target_type === 'document' ? logEvent(link.target_id, session.user.id, 'joined', text) : logSpaceEvent(link.target_id, session.user.id, 'joined', text))
  }
  throw redirect(link.target_type === 'document' ? `/doc/${link.target_id}` : `/space/${link.target_id}`)
}
