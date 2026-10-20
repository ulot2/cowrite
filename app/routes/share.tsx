import { redirect } from 'react-router'
import { getAuth } from '~/lib/auth.server'
import { deleteShareLink, findShareLink, redeemShareLink } from '~/lib/access.server'
import { logEvent, logSpaceEvent } from '~/lib/events.server'
import type { Route } from './+types/share'

// /s/<token>: following a share link or an invitation. Signed out people go through login (sign-up
// for an invitation) and come back here.
export async function loader({ request, params }: Route.LoaderArgs) {
  const link = await findShareLink(params.token)
  if (!link) throw new Response('This link is no longer valid', { status: 404 })
  const session = await getAuth().api.getSession({ headers: request.headers })
  if (!session) throw redirect(`/login?next=${encodeURIComponent(`/s/${params.token}`)}${link.email ? '&mode=up' : ''}`)
  if (link.email) await deleteShareLink(link.token) // an invitation works once
  if (await redeemShareLink(link, session.user.id)) {
    const text = link.email ? `accepted an invitation as ${link.role}` : `joined through a link as ${link.role}`
    await (link.target_type === 'document' ? logEvent(link.target_id, session.user.id, 'joined', text) : logSpaceEvent(link.target_id, session.user.id, 'joined', text))
  }
  throw redirect(link.target_type === 'document' ? `/doc/${link.target_id}` : `/space/${link.target_id}`)
}
