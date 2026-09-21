import { Form, Link } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { getDocument, renameDocument, roleOf } from '~/lib/db.server'
import { colorFor } from '~/lib/color'
import { Editor } from '~/components/editor'
import type { Route } from './+types/doc'

export const meta = ({ loaderData }: Route.MetaArgs) => [{ title: `${loaderData?.document.title ?? 'Document'} · cowrite` }]

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const role = await roleOf(params.id, user.id)
  const document = role && await getDocument(params.id)
  if (!role || !document) throw new Response('Not found', { status: 404 })
  return { user: { id: user.id, name: user.name, color: colorFor(user.id) }, role, document }
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
    <article className="document" key={params.id}>
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/documents">Documents</Link><span aria-hidden="true">/</span><span>{document.title}</span></nav>
      <Editor documentId={params.id} user={user} readOnly={role === 'viewer'}>
        {role === 'owner' ? (
          // The title saves when you leave the field or press Enter. Enter must not add a line break.
          <Form method="post" onBlur={(e) => e.currentTarget.requestSubmit()}>
            <input className="title" name="title" defaultValue={document.title} aria-label="Document title" maxLength={120}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }} />
          </Form>
        ) : (
          <h1 className="title">{document.title}</h1>
        )}
      </Editor>
    </article>
  )
}
