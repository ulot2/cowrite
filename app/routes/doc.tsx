import { Form, Link } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { clearPublished, getDocument, renameDocument, setPublished, setStatus } from '~/lib/db.server'
import { docStub } from '~/lib/versions.server'
import { moves, statusLabel, type Move } from '~/lib/status'
import { createShareLink, findUser, findUserByEmail, getShareLink, getSpace, listMembers, listSpaces, moveDocument, removeMember, revokeShareLink, roleOnDocument, roleOnSpace, setMember } from '~/lib/access.server'
import { logEvent } from '~/lib/events.server'
import { atLeast, type Role } from '~/lib/roles'
import { colorFor } from '~/lib/color'
import { Editor } from '~/components/editor'
import { Icon } from '~/components/icon'
import { ShareDialog } from '~/components/share-dialog'
import { StatusMenu } from '~/components/status-menu'
import { MoreMenu } from '~/components/more-menu'
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
  if (intent === 'status') {
    // One move at a time, from the status the document has now, by a role that may make it.
    const move = moves[String(f.get('move')) as Move]
    if (!move || !atLeast(role, move.need)) throw new Response('You cannot make this change', { status: 403 })
    if (document.status !== move.from) return { error: `The document is not ${statusLabel[move.from].toLowerCase()} any more.` }
    await setStatus(params.id, move.to)
    await logEvent(params.id, user.id, 'status', move.text)
    return null
  }
  if (intent === 'suggestion') {
    // The editor already applied it; this is the trace, so the author hears about it.
    if (!atLeast(role, 'editor')) throw new Response('Editors resolve suggestions', { status: 403 })
    const outcome = f.get('outcome') === 'rejected' ? 'rejected' : 'accepted'
    const author = await findUser(String(f.get('author') ?? ''))
    await logEvent(params.id, user.id, 'suggestion', author ? `${outcome} a suggestion by ${author.id === user.id ? 'themselves' : author.name}` : `${outcome} all suggestions`)
    return null
  }
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
    case 'publish': {
      // A new version named "Published"; the slug is made once and kept across unpublish.
      const version = await docStub(params.id).publish(user.id)
      const slug = document.published_slug ?? `${document.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'document'}-${crypto.randomUUID().slice(0, 6)}`
      await setPublished(params.id, slug, version)
      await logEvent(params.id, user.id, 'published', document.published_version ? 'updated the public page' : 'published it to the web')
      return null
    }
    case 'unpublish': await clearPublished(params.id); await logEvent(params.id, user.id, 'published', 'unpublished it'); return null
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
  // A reviewer types too, in suggest mode; the editor enforces that, the server lets reviewers write.
  const canEdit = atLeast(role, 'reviewer')
  return (
    <article className="document" key={params.id}>
      <Editor documentId={params.id} user={user} canEdit={canEdit} canComment={atLeast(role, 'commenter')} canSuggest={canEdit} mustSuggest={role === 'reviewer'} canResolve={atLeast(role, 'editor')} people={members.map((m) => ({ id: m.user_id, name: m.name }))}
        crumbs={<div className="doc-where"><nav className="crumbs" aria-label="Breadcrumb"><Link to="/documents">Documents</Link><span aria-hidden="true">/</span><span>{document.title}</span></nav><StatusMenu status={document.status} role={role} /></div>}
        actions={<>
          <Link className="tool" to={`/doc/${params.id}/history`}><Icon name="history" /><span className="tool-label">History</span></Link>
          <ShareDialog target="document" isOwner={isOwner} members={members} link={link} spaces={spaces} spaceId={document.space_id} published={{ slug: document.published_slug, at: document.published_at }} className="tool" />
          <MoreMenu documentId={params.id} />
        </>}>
        {atLeast(role, 'editor') ? (
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
