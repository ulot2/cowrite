import { Link, redirect } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { getSpace, roleOnSpace } from '~/lib/access.server'
import { createSpaceFromForm } from '~/lib/create-space.server'
import { claimGuestDocuments, clearGuestCookie } from '~/lib/guest.server'
import { CreateSpaceForm } from '~/components/create-space'
import { Logo } from '~/components/logo'
import type { Route } from './+types/welcome'

export const meta = () => [{ title: 'Create a space · cowrite' }]

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const saved = await claimGuestDocuments(request, user.id)
  if (saved) throw redirect(`/documents?saved=${saved}`, { headers: { 'Set-Cookie': clearGuestCookie(request) } })
  // Old onboarding bookmarks now open the space; adding people is optional in Share.
  const id = new URL(request.url).searchParams.get('space')
  if (id && await roleOnSpace(user.id, id) === 'owner' && await getSpace(id)) throw redirect(`/space/${id}`)
  return { firstName: user.name.split(' ')[0] }
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request)
  return createSpaceFromForm(user.id, await request.formData())
}

export default function Welcome({ loaderData }: Route.ComponentProps) {
  return (
    <main className="onb space-onboarding">
      <header className="onb-top">
        <Link to="/" className="brand"><Logo /></Link>
        <Link className="onb-skip" to="/">Skip for now</Link>
      </header>
      <div className="space-onboarding-body">
        <p className="muted">Welcome, {loaderData.firstName}.</p>
        <CreateSpaceForm action="/welcome" heading="page" />
        <p className="muted small">Start on your own. Add people whenever you’re ready.</p>
      </div>
    </main>
  )
}
