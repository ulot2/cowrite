import { data, Link, redirect } from 'react-router'
import { getAuth } from '~/lib/auth.server'
import { createGuestDocument, GuestLimit, guestId, listGuestDocuments } from '~/lib/guest.server'
import { Logo } from '~/components/logo'
import type { Route } from './+types/play'

export const meta = () => [{ title: 'Try CoWrite' }, { name: 'robots', content: 'noindex' }]

// "Try it, no sign-up": the newest guest document of this browser, or a first one with a short tour.
export async function loader({ request }: Route.LoaderArgs) {
  if (await getAuth().api.getSession({ headers: request.headers })) throw redirect('/')
  const guest = guestId(request)
  const newest = guest ? (await listGuestDocuments(guest))[0] : undefined
  if (newest) throw redirect(`/g/${newest.id}`)
  try {
    const { id, cookie } = await createGuestDocument(request, true)
    throw redirect(`/g/${id}`, { headers: { 'Set-Cookie': cookie } })
  } catch (e) {
    if (e instanceof GuestLimit) return data({ error: e.message }, { status: 429 })
    throw e
  }
}

// Only when the limit on new guests is reached.
export default function Play({ loaderData }: Route.ComponentProps) {
  return (
    <main className="guest">
      <header className="guest-top"><Link to="/" className="brand"><Logo /></Link></header>
      <section className="empty">
        <h1>Try CoWrite</h1>
        <p className="muted">{loaderData.error}</p>
        <Link className="button primary" to="/login?mode=up">Sign up free</Link>
      </section>
    </main>
  )
}
