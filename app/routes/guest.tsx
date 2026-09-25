import { Form, Link, redirect, useActionData, useNavigation } from 'react-router'
import { getAuth } from '~/lib/auth.server'
import { createGuestDocument, GUEST_DAYS, GuestLimit, guestId, listGuestDocuments, MAX_GUEST_DOCS } from '~/lib/guest.server'
import { timeAgo } from '~/lib/time'
import { Logo } from '~/components/logo'
import { Icon } from '~/components/icon'
import { ThemeToggle } from '~/components/theme-toggle'
import type { Route } from './+types/guest'

export const meta = () => [{ title: 'Your documents · cowrite' }, { name: 'robots', content: 'noindex' }]

// A guest's documents: the ones this browser made without an account. Signed in, the account's own list.
export async function loader({ request }: Route.LoaderArgs) {
  if (await getAuth().api.getSession({ headers: request.headers })) throw redirect('/documents')
  const guest = guestId(request)
  return { documents: guest ? await listGuestDocuments(guest) : [], days: GUEST_DAYS, max: MAX_GUEST_DOCS }
}

export async function action({ request }: Route.ActionArgs) {
  try {
    const { id, cookie } = await createGuestDocument(request, false)
    throw redirect(`/g/${id}`, { headers: { 'Set-Cookie': cookie } })
  } catch (e) {
    if (e instanceof GuestLimit) return { error: e.message }
    throw e
  }
}

export default function Guest({ loaderData }: Route.ComponentProps) {
  const { documents, days, max } = loaderData
  const error = useActionData<typeof action>()?.error
  const busy = useNavigation().state !== 'idle'
  return (
    <main className="guest">
      <header className="guest-top">
        <Link to="/" className="brand"><Logo /></Link>
        <span className="guest-top-actions"><ThemeToggle className="ghost" /><Link className="button primary" to="/login?mode=up">Sign up to keep them</Link></span>
      </header>
      <div className="page">
        <header className="page-head">
          <div>
            <h1>Your documents</h1>
            <p className="muted">You are not signed in. These documents are kept in this browser for {days} days after your last edit. Sign up, and they move into your account.</p>
          </div>
          <Form method="post"><button className="primary" disabled={busy || documents.length >= max}><Icon name="plus" />New document</button></Form>
        </header>
        {error && <p className="error" role="alert">{error}</p>}
        {documents.length >= max && <p className="muted small">This is the most you can have without an account. Sign up to make more, or delete one.</p>}
        {documents.length === 0 ? (
          <section className="empty">
            <h2>No documents yet</h2>
            <p className="muted">Make one. Only this browser can open it.</p>
          </section>
        ) : (
          <div className="cards">
            {documents.map((d, i) => (
              <Link key={d.id} to={`/g/${d.id}`} className="card" style={{ '--i': i } as React.CSSProperties}>
                <span className="card-title">{d.title}</span>
                <span className="card-preview">{d.preview || 'Nothing written yet.'}</span>
                <span className="card-meta"><span>Edited {timeAgo(d.updated_at)}</span></span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
