import { Form, Link, redirect } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { createDocument, deleteDocument, listDocuments, roleOf } from '~/lib/db.server'
import { colorFor } from '~/lib/color'
import { timeAgo } from '~/lib/time'
import { Avatar } from '~/components/avatar'
import type { Route } from './+types/home'

export const meta = () => [{ title: 'Documents · cowrite' }]

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const documents = await listDocuments(user.id)
  return { owner: { name: user.name, color: colorFor(user.id) }, documents }
}

// One action, two intents. Each one checks the role again: the form is not trusted.
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request)
  const f = await request.formData()
  const intent = f.get('intent')
  if (intent === 'create') {
    const title = String(f.get('title') ?? '').trim().slice(0, 120)
    throw redirect(`/doc/${await createDocument(user.id, title || 'Untitled')}`)
  }
  const id = String(f.get('id'))
  if ((await roleOf(id, user.id)) !== 'owner') throw new Response('Only the owner can do that', { status: 403 })
  if (intent === 'delete') await deleteDocument(id)
  return null
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { owner, documents } = loaderData
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Documents</h1>
          <p className="muted">{documents.length === 0 ? 'Nothing here yet.' : `${documents.length} ${documents.length === 1 ? 'document' : 'documents'}`}</p>
        </div>
        <Form method="post"><button className="primary" name="intent" value="create">New document</button></Form>
      </header>

      {documents.length === 0 ? (
        <section className="empty">
          <h2>Start your first document</h2>
          <p className="muted">Write alone, or open the same document in two places and watch it stay in sync.</p>
          <Form method="post"><button className="primary" name="intent" value="create">New document</button></Form>
        </section>
      ) : (
        <ul className="docs">
          {documents.map((d, i) => (
            <li key={d.id} style={{ '--i': i } as React.CSSProperties}>
              <Link to={`/doc/${d.id}`} className="doc-link">
                <span className="doc-title">{d.title}</span>
                <span className="doc-meta">Edited {timeAgo(d.updated_at)}</span>
              </Link>
              <span className="avatars"><Avatar name={owner.name} color={owner.color} size={24} /></span>
              {d.role === 'owner' && (
                <Form method="post" onSubmit={(e) => { if (!confirm(`Delete "${d.title}"? This cannot be undone.`)) e.preventDefault() }}>
                  <input type="hidden" name="id" value={d.id} />
                  <button className="quiet" name="intent" value="delete" aria-label={`Delete ${d.title}`}>Delete</button>
                </Form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
