import { Form, redirect } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { createDocument, listSpaceDocuments } from '~/lib/db.server'
import { createShareLink, findUserByEmail, getShareLink, getSpace, listMembers, removeMember, revokeShareLink, roleOnSpace, setMember, setSpaceVisibility } from '~/lib/access.server'
import type { Role } from '~/lib/roles'
import { colorFor } from '~/lib/color'
import { DocCard } from '~/components/doc-card'
import { Icon } from '~/components/icon'
import { ShareDialog } from '~/components/share-dialog'
import type { Route } from './+types/space'

export const meta = ({ loaderData }: Route.MetaArgs) => [{ title: `${loaderData?.space.name ?? 'Space'} · cowrite` }]

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const role = await roleOnSpace(user.id, params.id)
  const space = role && await getSpace(params.id)
  if (!role || !space) throw new Response('Not found', { status: 404 })
  const isOwner = role === 'owner'
  return {
    owner: { name: user.name, color: colorFor(user.id) },
    space, role, isOwner,
    documents: await listSpaceDocuments(params.id, role),
    members: await listMembers('space', params.id),
    link: isOwner ? await getShareLink('space', params.id) : null,
  }
}

const grantable: Role[] = ['viewer', 'commenter', 'reviewer', 'editor']

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request)
  const f = await request.formData()
  const intent = String(f.get('intent'))
  const role = await roleOnSpace(user.id, params.id)
  if (intent === 'create') {
    if (role !== 'owner' && role !== 'editor') throw new Response('Editors can add documents', { status: 403 })
    throw redirect(`/doc/${await createDocument(user.id, 'Untitled', params.id)}`)
  }
  if (role !== 'owner') throw new Response('Only the owner can change the space', { status: 403 })
  const pick = String(f.get('role'))
  const granted = grantable.includes(pick as Role) ? (pick as Role) : 'viewer'
  switch (intent) {
    case 'add': {
      const person = await findUserByEmail(String(f.get('email') ?? ''))
      if (!person) return { error: 'No account has that email. Ask them to sign up first.' }
      if (person.id !== user.id) await setMember('space', params.id, person.id, granted)
      return null
    }
    case 'role': await setMember('space', params.id, String(f.get('user_id')), granted); return null
    case 'remove': await removeMember('space', params.id, String(f.get('user_id'))); return null
    case 'link-create': await createShareLink('space', params.id, granted, user.id); return null
    case 'link-revoke': await revokeShareLink('space', params.id); return null
    case 'visibility': await setSpaceVisibility(params.id, f.get('visibility') === 'public' ? 'public' : 'private'); return null
  }
  return null
}

export default function Space({ loaderData, actionData }: Route.ComponentProps) {
  const { owner, space, role, isOwner, documents, members, link } = loaderData
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{space.name}</h1>
          <p className="muted">{members.length} {members.length === 1 ? 'member' : 'members'} · {space.visibility === 'public' ? 'Anyone with the link can view' : 'Private'}</p>
        </div>
        <div className="head-actions">
          <ShareDialog target="space" isOwner={isOwner} members={members} link={link} error={actionData?.error} />
          {isOwner && (
            <Form method="post">
              <input type="hidden" name="intent" value="visibility" />
              <input type="hidden" name="visibility" value={space.visibility === 'public' ? 'private' : 'public'} />
              <button>{space.visibility === 'public' ? 'Make private' : 'Make public'}</button>
            </Form>
          )}
          {(role === 'owner' || role === 'editor') && <Form method="post"><button className="primary" name="intent" value="create"><Icon name="plus" />New document</button></Form>}
        </div>
      </header>
      {documents.length === 0 ? (
        <section className="empty">
          <h2>Nothing in this space yet</h2>
          <p className="muted">Documents made here are shared with every member of the space.</p>
        </section>
      ) : (
        <div className="cards">{documents.map((d, i) => <DocCard key={d.id} doc={d} owner={owner} index={i} />)}</div>
      )}
    </div>
  )
}
