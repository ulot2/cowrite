import { Form } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { deleteDocument, listDocuments } from '~/lib/db.server'
import { roleOnDocument } from '~/lib/access.server'
import { colorFor } from '~/lib/color'
import { DocCard } from '~/components/doc-card'
import { Icon } from '~/components/icon'
import type { Route } from './+types/documents'

export const meta = () => [{ title: 'Documents · cowrite' }]

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  return { q, owner: { name: user.name, color: colorFor(user.id) }, documents: await listDocuments(user.id, { q }) }
}

// Delete checks the role again: the form is not trusted.
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request)
  const f = await request.formData()
  const id = String(f.get('id'))
  if (f.get('intent') !== 'delete') return null
  if ((await roleOnDocument(user.id, id)) !== 'owner') throw new Response('Only the owner can delete', { status: 403 })
  await deleteDocument(id)
  return null
}

export default function Documents({ loaderData }: Route.ComponentProps) {
  const { q, owner, documents } = loaderData
  const n = documents.length
  const count = n === 1 ? '1 document' : `${n} documents`
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{q ? `Results for "${q}"` : 'Documents'}</h1>
          <p className="muted">{n === 0 ? (q ? 'No document matches.' : 'Nothing here yet.') : count}</p>
        </div>
      </header>
      {n === 0 && !q ? (
        <section className="empty">
          <h2>Start your first document</h2>
          <p className="muted">Write alone, or open the same document in two places and watch it stay in sync.</p>
          <Form method="post" action="/?index"><button className="primary" name="intent" value="create"><Icon name="plus" />New document</button></Form>
        </section>
      ) : (
        <div className="cards">
          {!q && (
            <Form method="post" action="/?index" className="card card-new">
              <button className="ghost" name="intent" value="create"><Icon name="plus" />New document</button>
            </Form>
          )}
          {documents.map((d, i) => (
            <div className="card-wrap" key={d.id}>
              <DocCard doc={d} owner={owner} index={i} />
              {d.role === 'owner' && (
                <Form method="post" onSubmit={(e) => { if (!confirm(`Delete "${d.title}"? This cannot be undone.`)) e.preventDefault() }}>
                  <input type="hidden" name="id" value={d.id} />
                  <button className="ghost card-delete" name="intent" value="delete" aria-label={`Delete ${d.title}`}>Delete</button>
                </Form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
