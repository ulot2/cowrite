import { Form, Link } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { getDocument, renameDocument } from '~/lib/db.server'
import { createShareLink, findUser, findUserByEmail, getShareLink, getSpace, listMembers, listSpaces, moveDocument, removeMember, revokeShareLink, roleOnDocument, roleOnSpace, setMember } from '~/lib/access.server'
import { logEvent } from '~/lib/events.server'
import { atLeast, type Role } from '~/lib/roles'
import { colorFor } from '~/lib/color'
import { Editor } from '~/components/editor'
import { Icon } from '~/components/icon'
import { ShareDialog } from '~/components/share-dialog'
import type { Route } from './+types/doc'

export const meta = ({ loaderData }: Route.MetaArgs) => [{ title: `${loaderData?.document.title ?? 'Document'} · cowrite` }]

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const role = await roleOnDocument(user.id, params.id)
  const document = role && await getDocument(params.id)
  if (!role || !document) throw new Response('Not found', { status: 404 })
  const isOwner = role === 'owner'
  return {
    user: { id: user.id, name: user.name, color: colorFor(user.id) },
    role, document, isOwner,
    members: await listMembers('document', params.id),
    link: isOwner ? await getShareLink('document', params.id) : null,
    spaces: isOwner ? (await listSpaces(user.id)).filter((s) => s.owner_id === user.id) : [],
    error: new URL(request.url).searchParams.get('error'),
  }
}

const grantable: Role[] = ['viewer', 'commenter', 'reviewer', 'editor']

// Every intent checks the role again: the form is not trusted.
export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request)
  const f = await request.formData()
  const intent = String(f.get('intent'))
  const role = await roleOnDocument(user.id, params.id)
  const document = role && await getDocument(params.id)
  if (!role || !document) throw new Response('Not found', { status: 404 })
  if (intent === 'rename') {
    if (!atLeast(role, 'editor')) throw new Response('Editors can rename', { status: 403 })
    const title = String(f.get('title') ?? '').trim().slice(0, 120)
    if (title && title !== document.title) {
      await renameDocument(params.id, title)
      await logEvent(params.id, user.id, 'renamed', `renamed “${document.title}” to “${title}”`)
    }
    return null
  }
  if (role !== 'owner') throw new Response('Only the owner can share', { status: 403 })
  const pick = String(f.get('role'))
  const granted = grantable.includes(pick as Role) ? (pick as Role) : 'viewer'
  switch (intent) {
    case 'add': {
      const person = await findUserByEmail(String(f.get('email') ?? ''))
      if (!person) return { error: 'No account has that email. Ask them to sign up first.' }
      if (person.id !== user.id) {
        await setMember('document', params.id, person.id, granted)
        await logEvent(params.id, user.id, 'shared', `added ${person.name} as ${granted}`)
      }
      return null
    }
    case 'role': case 'remove': {
      const person = await findUser(String(f.get('user_id')))
      if (!person) return null
      if (intent === 'role') await setMember('document', params.id, person.id, granted)
      else await removeMember('document', params.id, person.id)
      await logEvent(params.id, user.id, 'shared', intent === 'role' ? `made ${person.name} ${granted}` : `removed ${person.name}`)
      return null
    }
    case 'link-create': await createShareLink('document', params.id, granted, user.id); await logEvent(params.id, user.id, 'shared', `created a ${granted} link`); return null
    case 'link-revoke': await revokeShareLink('document', params.id); await logEvent(params.id, user.id, 'shared', 'revoked the link'); return null
    case 'move': {
      const spaceId = String(f.get('space_id') ?? '') || null
      if (spaceId && (await roleOnSpace(user.id, spaceId)) !== 'owner') throw new Response('Not your space', { status: 403 })
      // Logged before the move, so the old space keeps a trace of the document leaving.
      const space = spaceId ? await getSpace(spaceId) : null
      await logEvent(params.id, user.id, 'moved', space ? `moved “${document.title}” to ${space.name}` : `moved “${document.title}” out of its space`)
      await moveDocument(params.id, spaceId)
      if (space) await logEvent(params.id, user.id, 'moved', `moved “${document.title}” here`)
      return null
    }
  }
  return null
}

export default function Doc({ loaderData, actionData, params }: Route.ComponentProps) {
  const { user, role, document, isOwner, members, link, spaces } = loaderData
  const canEdit = atLeast(role, 'editor')
  return (
    <article className="document" key={params.id}>
      <Editor documentId={params.id} user={user} canEdit={canEdit} canComment={atLeast(role, 'commenter')}
        crumbs={<nav className="crumbs" aria-label="Breadcrumb"><Link to="/documents">Documents</Link><span aria-hidden="true">/</span><span>{document.title}</span></nav>}
        actions={<>
          <Link className="tool" to={`/doc/${params.id}/history`}><Icon name="history" /><span className="tool-label">History</span></Link>
          <ShareDialog target="document" isOwner={isOwner} members={members} link={link} spaces={spaces} spaceId={document.space_id} error={actionData?.error} className="tool" />
        </>}>
        {canEdit ? (
          // The title saves when you leave the field or press Enter. Enter must not add a line break.
          <Form method="post" onBlur={(e) => e.currentTarget.requestSubmit()}>
            <input type="hidden" name="intent" value="rename" />
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
