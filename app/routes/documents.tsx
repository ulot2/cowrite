import { Form } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { deleteDocument, getDocument, listDocuments } from '~/lib/db.server'
import { logEvent } from '~/lib/events.server'
import { searchHits } from '~/lib/search.server'
import { roleOnDocument } from '~/lib/access.server'
import { colorFor } from '~/lib/color'
import { DocCard } from '~/components/doc-card'
import { Icon } from '~/components/icon'
import { Confirm } from '~/components/confirm'
import type { Route } from './+types/documents'

export const meta = () => [{ title: 'Documents · cowrite' }]

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  const owner = { name: user.name, color: user.color, image: user.image }
  if (!q) return { q, owner, documents: (await listDocuments(user.id)).map((d) => ({ ...d, hit: null })) }
  // Search: full-text hits in rank order, each with the words it matched.
  const hits = await searchHits(user.id, q)
  const byId = new Map((await listDocuments(user.id)).map((d) => [d.id, d]))
  return { q, owner, documents: hits.flatMap((h) => { const d = byId.get(h.document_id); return d ? [{ ...d, hit: h }] : [] }) }
}

// Delete checks the role again: the form is not trusted.
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request)
  const f = await request.formData()
  const id = String(f.get('id'))
  if (f.get('intent') !== 'delete') return null
  if ((await roleOnDocument(user.id, id)) !== 'owner') throw new Response('Only the owner can delete', { status: 403 })
  // Logged first: the event copies the space id from the row that is about to go.
  const doc = await getDocument(id)
  if (doc) await logEvent(id, user.id, 'deleted', `deleted “${doc.title}”`)
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
              <DocCard doc={d} owner={owner} index={i} hit={d.hit} />
              {d.role === 'owner' && (
                <Confirm title={`Delete “${d.title}”?`} confirm="Delete document" busy="Deleting…" fields={{ intent: 'delete', id: d.id }}
                  trigger={(open) => <button type="button" className="ghost card-delete" aria-label={`Delete ${d.title}`} onClick={open}>Delete</button>}>
                  <p>The text, its comments, its versions, and its public page go away for everyone. This cannot be undone.</p>
                </Confirm>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
