import { Form, Link, redirect } from 'react-router'
import { getAuth } from '~/lib/auth.server'
import { deleteGuestDocument, getGuestDocument, GUEST_DAYS, guestId, renameGuestDocument } from '~/lib/guest.server'
import { Editor } from '~/components/editor'
import { MoreMenu } from '~/components/more-menu'
import { Confirm } from '~/components/confirm'
import { Logo } from '~/components/logo'
import { Icon } from '~/components/icon'
import type { Route } from './+types/guest-doc'

export const meta = ({ loaderData }: Route.MetaArgs) => [{ title: `${loaderData?.document.title ?? 'Document'} · cowrite` }, { name: 'robots', content: 'noindex' }]

// One guest document. Only the browser whose cookie owns it can open it. Signed in, the document
// was claimed on sign-in (or is not yours), so the normal page decides.
export async function loader({ request, params }: Route.LoaderArgs) {
  if (await getAuth().api.getSession({ headers: request.headers })) throw redirect(`/doc/${params.id}`)
  const document = await getGuestDocument(params.id, guestId(request))
  if (!document) throw new Response('Not found', { status: 404 })
  return { document, days: GUEST_DAYS }
}

// Rename and delete. The editor also reports accepted suggestions here; there is nobody to tell.
export async function action({ request, params }: Route.ActionArgs) {
  const guest = guestId(request)
  if (!guest || !(await getGuestDocument(params.id, guest))) throw new Response('Not found', { status: 404 })
  const f = await request.formData()
  if (f.get('intent') === 'rename') {
    const title = String(f.get('title') ?? '').trim().slice(0, 120)
    if (title) await renameGuestDocument(params.id, guest, title)
  }
  if (f.get('intent') === 'delete') {
    await deleteGuestDocument(params.id, guest)
    throw redirect('/g')
  }
  return null
}

const guest = { id: 'guest', name: 'You', color: '#2e7d32' }

export default function GuestDoc({ loaderData, params }: Route.ComponentProps) {
  const { document, days } = loaderData
  return (
    <main className="guest">
      <article className="document" key={params.id}>
        <Editor documentId={params.id} user={guest} canEdit canComment={false} canSuggest mustSuggest={false} canResolve nib={false} people={[]}
          crumbs={<div className="doc-where"><Link to="/" className="brand"><Logo /></Link><nav className="crumbs" aria-label="Breadcrumb"><Link to="/g"><Icon name="collapse" />Your documents</Link></nav></div>}
          actions={<>
            <div className="tool-group" role="group" aria-label="Document">
              <MoreMenu documentId={params.id} />
              <Confirm title={`Delete “${document.title}”?`} confirm="Delete document" busy="Deleting…" fields={{ intent: 'delete' }}
                trigger={(open) => <button type="button" className="tool danger" data-tip="Delete" onClick={open}><Icon name="trash" /><span className="tool-label">Delete</span></button>}>
                <p>The document and its versions go away. This cannot be undone.</p>
              </Confirm>
            </div>
            <Link className="tool guest-cta" to="/login?mode=up" aria-label="Sign up to keep it"><span className="cta-long">Sign up to keep it</span><span className="cta-short" aria-hidden="true">Sign up</span></Link>
          </>}>
          {/* The title saves when you leave the field or press Enter. */}
          <Form method="post" onBlur={(e) => e.currentTarget.requestSubmit()}>
            <input type="hidden" name="intent" value="rename" />
            <input className="title" name="title" defaultValue={document.title} aria-label="Document title" maxLength={120}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }} />
          </Form>
          <p className="guest-note">Only this browser can open this document. It stays for {days} days after your last edit.</p>
        </Editor>
      </article>
    </main>
  )
}
