import { Form, Link, redirect, useNavigate } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { authClient } from '~/lib/auth.client'
import { createDocument, deleteDocument, listDocuments, renameDocument, roleOf } from '~/lib/db.server'
import type { Route } from './+types/home'

export const meta = () => [{ title: 'Your documents · cowrite' }]

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  return { user, documents: await listDocuments(user.id) }
}

// One action, three intents. Each one checks the role again: the form is not trusted.
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request)
  const f = await request.formData()
  const intent = f.get('intent')
  const title = String(f.get('title') ?? '').trim().slice(0, 120)
  if (intent === 'create') {
    const id = await createDocument(user.id, title || 'Untitled')
    throw redirect(`/doc/${id}`)
  }
  const id = String(f.get('id'))
  if ((await roleOf(id, user.id)) !== 'owner') throw new Response('Only the owner can do that', { status: 403 })
  if (intent === 'rename' && title) await renameDocument(id, title)
  if (intent === 'delete') await deleteDocument(id)
  return null
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate()
  const { user, documents } = loaderData
  return (
    <main className="page">
      <header className="bar">
        <span className="brand">cowrite</span>
        <div className="right">
          <span className="muted">{user.name}</span>
          <button className="quiet" type="button" onClick={async () => { await authClient.signOut(); navigate('/login') }}>Sign out</button>
        </div>
      </header>

      <Form method="post" className="new">
        <input name="title" placeholder="New document title" aria-label="New document title" maxLength={120} />
        <button className="primary" name="intent" value="create">New document</button>
      </Form>

      {documents.length === 0 ? (
        <p className="empty">No documents yet. Give one a title above and press New document.</p>
      ) : (
        <ul className="docs">
          {documents.map((d, i) => (
            <li key={d.id} style={{ '--i': i } as React.CSSProperties}>
              <Link to={`/doc/${d.id}`}>{d.title}</Link>
              <time dateTime={new Date(d.updated_at).toISOString()}>{new Date(d.updated_at).toLocaleDateString()}</time>
              {d.role === 'owner' && (
                <Form method="post" onSubmit={(e) => { if (!confirm(`Delete "${d.title}"? This cannot be undone.`)) e.preventDefault() }}>
                  <input type="hidden" name="id" value={d.id} />
                  <button className="quiet danger" name="intent" value="delete" aria-label={`Delete ${d.title}`}>Delete</button>
                </Form>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
