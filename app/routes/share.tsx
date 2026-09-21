import { redirect } from 'react-router'
import { getAuth } from '~/lib/auth.server'
import { findShareLink, redeemShareLink } from '~/lib/access.server'
import type { Route } from './+types/share'

// /s/<token>: following a share link. Signed out people go through login and come back here.
export async function loader({ request, params }: Route.LoaderArgs) {
  const session = await getAuth().api.getSession({ headers: request.headers })
  if (!session) throw redirect(`/login?next=${encodeURIComponent(`/s/${params.token}`)}`)
  const link = await findShareLink(params.token)
  if (!link) throw new Response('This link is no longer valid', { status: 404 })
  await redeemShareLink(link, session.user.id)
  throw redirect(link.target_type === 'document' ? `/doc/${link.target_id}` : `/space/${link.target_id}`)
}
