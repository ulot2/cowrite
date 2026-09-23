import { Form, Link, redirect } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { createInMode, listSpaceDocuments, type Mode } from '~/lib/db.server'
import { deleteSpace, createShareLink, findUser, findUserByEmail, getShareLink, getSpace, listMembers, removeMember, revokeShareLink, roleOnSpace, setMember, setSpaceVisibility } from '~/lib/access.server'
import { listSpaceDecisions } from '~/lib/work.server'
import { listSpaceEvents, logEvent, logSpaceEvent } from '~/lib/events.server'
import { Activity } from '~/components/activity'
import type { Role } from '~/lib/roles'
import { colorFor } from '~/lib/color'
import { Avatar } from '~/components/avatar'
import { DocCard } from '~/components/doc-card'
import { Icon } from '~/components/icon'
import { NewMenu } from '~/components/new-menu'
import { Confirm } from '~/components/confirm'
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
    owner: { name: user.name, color: user.color, image: user.image },
    space, role, isOwner,
    documents: await listSpaceDocuments(params.id, role),
    members: await listMembers('space', params.id),
    link: isOwner ? await getShareLink('space', params.id) : null,
    events: await listSpaceEvents(params.id),
    decisions: await listSpaceDecisions(params.id),
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
    const { id, title } = await createInMode(user.id, String(f.get('mode') ?? 'write') as Mode, params.id)
    await logEvent(id, user.id, 'created', `created “${title}”`)
    throw redirect(`/doc/${id}`)
  }
  if (role !== 'owner') throw new Response('Only the owner can change the space', { status: 403 })
  if (intent === 'delete-space') {
    await deleteSpace(params.id)
    throw redirect('/')
  }
  const pick = String(f.get('role'))
  const granted = grantable.includes(pick as Role) ? (pick as Role) : 'viewer'
  switch (intent) {
    case 'add': {
      const person = await findUserByEmail(String(f.get('email') ?? ''))
      if (!person) return { error: 'No account has that email. Ask them to sign up first.' }
      if (person.id !== user.id) {
        await setMember('space', params.id, person.id, granted)
        await logSpaceEvent(params.id, user.id, 'shared', `added ${person.name} as ${granted}`)
      }
      return null
    }
    case 'role': case 'remove': {
      const person = await findUser(String(f.get('user_id')))
      if (!person) return null
      if (intent === 'role') await setMember('space', params.id, person.id, granted)
      else await removeMember('space', params.id, person.id)
      await logSpaceEvent(params.id, user.id, 'shared', intent === 'role' ? `made ${person.name} ${granted}` : `removed ${person.name}`)
      return null
    }
    case 'link-create': await createShareLink('space', params.id, granted, user.id); await logSpaceEvent(params.id, user.id, 'shared', `created a ${granted} link`); return null
    case 'link-revoke': await revokeShareLink('space', params.id); await logSpaceEvent(params.id, user.id, 'shared', 'revoked the link'); return null
    case 'visibility': {
      const visibility = f.get('visibility') === 'public' ? 'public' : 'private'
      await setSpaceVisibility(params.id, visibility)
      await logSpaceEvent(params.id, user.id, 'space', `made the space ${visibility}`)
      return null
    }
  }
  return null
}

export default function Space({ loaderData, actionData }: Route.ComponentProps) {
  const { owner, space, role, isOwner, documents, members, link, events, decisions } = loaderData
  return (
    <div className="page">
      <div className="doc-bar">
        <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">Home</Link><span aria-hidden="true">/</span><span>{space.name}</span></nav>
        <div className="doc-tools">
          {isOwner && (
            <Form method="post">
              <input type="hidden" name="intent" value="visibility" />
              <input type="hidden" name="visibility" value={space.visibility === 'public' ? 'private' : 'public'} />
              <button className="tool"><Icon name={space.visibility === 'public' ? 'lock' : 'globe'} /><span className="tool-label">{space.visibility === 'public' ? 'Make private' : 'Make public'}</span></button>
            </Form>
          )}
          {isOwner && (
            <Confirm title={`Delete “${space.name}”?`} confirm="Delete space" busy="Deleting…" fields={{ intent: 'delete-space' }}
              trigger={(open) => <button type="button" className="tool danger" title="Delete space" onClick={open}><Icon name="trash" /><span className="tool-label">Delete space</span></button>}>
              <p>The space, its members, and its share link go away. This cannot be undone.</p>
              <ul>
                <li><strong>{documents.length} {documents.length === 1 ? 'document is' : 'documents are'} kept.</strong> They move out of the space and stay with the people added to them.</li>
                <li>People who could open them only through this space lose access.</li>
              </ul>
            </Confirm>
          )}
          <ShareDialog target="space" isOwner={isOwner} members={members} link={link} className="tool" />
        </div>
      </div>
      <header className="page-title">
        <p className="eyebrow">{space.visibility === 'public' ? 'Public space' : 'Private space'}</p>
        <h1>{space.name}</h1>
        <div className="title-meta">
          <span className="avatars" aria-hidden="true">{members.slice(0, 5).map((m) => <Avatar key={m.user_id} name={m.name} color={colorFor(m.user_id, m.color)} image={m.image} size={26} />)}</span>
          <p className="muted">{members.length} {members.length === 1 ? 'member' : 'members'} · {space.visibility === 'public' ? 'anyone with the link can view' : 'only members can open it'}</p>
          {(role === 'owner' || role === 'editor') && <span className="title-action"><NewMenu action="" /></span>}
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
      {decisions.length > 0 && (
        <section className="decision-log" aria-labelledby="decisions-title">
          <h2 id="decisions-title">Decisions</h2>
          <ol>
            {decisions.map((d) => (
              <li key={d.id} data-status={d.status}>
                <span className="decision-number">{`D-${d.number}`}</span>
                <span className="decision-log-text">{d.text || 'Untitled decision'} <Link to={`/doc/${d.document_id}`}>{d.title}</Link></span>
                <span className="status" data-status={d.status === 'decided' ? 'approved' : d.status === 'dropped' ? 'draft' : 'review'}>{d.status[0].toUpperCase() + d.status.slice(1)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      <Activity events={events} />
    </div>
  )
}
