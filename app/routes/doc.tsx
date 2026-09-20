import { Form, Link } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { getDocument, renameDocument, roleOf } from '~/lib/db.server'
import { Editor } from '~/components/editor'
import type { Route } from './+types/doc'

export const meta = ({ loaderData }: Route.MetaArgs) => [{ title: `${loaderData?.document.title ?? 'Document'} · cowrite` }]

// Dark enough that the white name label on top of them passes the contrast rule (4.5:1).
const colors = ['#c2185b', '#1565c0', '#2e7d32', '#bf360c', '#6a1b9a', '#00695c']
const colorFor = (id: string) => colors[[...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % colors.length]

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const role = await roleOf(params.id, user.id)
  const document = role && await getDocument(params.id)
  if (!role || !document) throw new Response('Not found', { status: 404 })
  return { user: { name: user.name, color: colorFor(user.id) }, role, document }
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request)
  if ((await roleOf(params.id, user.id)) !== 'owner') throw new Response('Only the owner can rename', { status: 403 })
  const title = String((await request.formData()).get('title') ?? '').trim().slice(0, 120)
  if (title) await renameDocument(params.id, title)
  return null
}

export default function Doc({ loaderData, params }: Route.ComponentProps) {
  const { user, role, document } = loaderData
  return (
    <main className="page page-wide">
      <header className="bar">
        <Link to="/" aria-label="Back to your documents">← Documents</Link>
        {role === 'owner' ? (
          <Form method="post" className="title-form" onBlur={(e) => e.currentTarget.requestSubmit()}>
            <input name="title" defaultValue={document.title} aria-label="Document title" maxLength={120} />
          </Form>
        ) : (
          <h1 style={{ font: 'inherit', fontWeight: 500, margin: 0, flex: 1 }}>{document.title}</h1>
        )}
        <span className="muted right">{role}</span>
      </header>
      <Editor key={params.id} documentId={params.id} user={user} readOnly={role === 'viewer'} />
    </main>
  )
}
