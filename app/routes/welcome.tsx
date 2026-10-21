import { useState } from 'react'
import { Form, Link, redirect, useActionData, useNavigation } from 'react-router'
import { env } from 'cloudflare:workers'
import { requireUser } from '~/lib/auth.server'
import { createDocument } from '~/lib/db.server'
import { docStub } from '~/lib/versions.server'
import { createSpace, findUserByEmail, getSpace, roleOnSpace, setMember } from '~/lib/access.server'
import { readSpaceDetails } from '~/lib/create-space.server'
import { claimGuestDocuments, clearGuestCookie } from '~/lib/guest.server'
import { logEvent, logSpaceEvent } from '~/lib/events.server'
import type { Role } from '~/lib/roles'
import { Avatar } from '~/components/avatar'
import { Logo } from '~/components/logo'
import type { Route } from './+types/welcome'

export const meta = () => [{ title: 'Welcome · cowrite' }]

// Step 1 has no space yet. Step 2 is ?space=<id>, a space the person owns.
// Documents made before signing in (without an account) become this account's own, and the
// person lands on them, instead of on the welcome steps or home.
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const saved = await claimGuestDocuments(request, user.id)
  if (saved) throw redirect(`/documents?saved=${saved}`, { headers: { 'Set-Cookie': clearGuestCookie(request) } })
  const id = new URL(request.url).searchParams.get('space')
  const space = id && (await roleOnSpace(user.id, id)) === 'owner' ? await getSpace(id) : null
  if (id && !space) throw redirect('/welcome')
  return { me: { name: user.name, color: user.color, image: user.image ?? null }, space: space && { id: space.id, name: space.name } }
}

const roles: [Role, string][] = [
  ['editor', 'Writes documents, adds ideas, and records decisions.'],
  ['reviewer', 'Suggests changes, signs off sections, and approves.'],
  ['commenter', 'Joins discussions, comments, and answers questions.'],
  ['viewer', 'Reads everything in the space.'],
]

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request)
  const f = await request.formData()
  if (f.get('intent') === 'space' || f.get('intent') === 'new-space') {
    const details = readSpaceDetails(f)
    if ('error' in details) return details
    const id = await createSpace(user.id, details.name, details.description)
    const doc = await createDocument(user.id, 'Welcome to CoWrite', id)
    await docStub(doc).seed('welcome', { id: user.id, name: user.name })
    await logEvent(doc, user.id, 'created', 'created “Welcome to CoWrite”')
    await env.DB.prepare('UPDATE spaces SET welcome_doc = ? WHERE id = ?').bind(doc, id).run()
    throw redirect(`/welcome?space=${id}`)
  }
  // Step 2. Every email must have an account; if one does not, nobody is added and the step says which.
  const id = String(f.get('space'))
  if ((await roleOnSpace(user.id, id)) !== 'owner') throw new Response('Not found', { status: 404 })
  const emails = f.getAll('email').map((e) => String(e).trim())
  const picked = f.getAll('role').map(String)
  const rows = emails.map((email, i) => ({ email, role: (roles.some(([r]) => r === picked[i]) ? picked[i] : 'viewer') as Role })).filter((r) => r.email)
  const found = await Promise.all(rows.map((r) => findUserByEmail(r.email)))
  const missing = rows.filter((_, i) => !found[i]).map((r) => r.email)
  if (missing.length) return { error: `No account has ${missing.length === 1 ? 'this email' : 'these emails'}: ${missing.join(', ')}. Ask them to sign up first, or remove ${missing.length === 1 ? 'it' : 'them'}.` }
  for (const [i, person] of found.entries()) {
    if (!person || person.id === user.id) continue
    await setMember('space', id, person.id, rows[i].role)
    await logSpaceEvent(id, user.id, 'shared', `added ${person.name} as ${rows[i].role}`)
  }
  throw redirect(`/space/${id}`)
}

const examples = ['Q4 launch', 'Hiring a designer', 'Website rewrite']

export default function Welcome({ loaderData }: Route.ComponentProps) {
  const { me, space } = loaderData
  const error = useActionData<typeof action>()?.error
  const busy = useNavigation().state !== 'idle'
  return (
    <div className="onb">
      <header className="onb-top">
        <Link to="/" className="brand"><Logo /></Link>
        <span className="muted">Step {space ? 2 : 1} of 2</span>
        <Link className="onb-skip" to={space ? `/space/${space.id}` : '/'}>Skip for now</Link>
      </header>
      <div className="onb-bar" aria-hidden="true"><i style={{ width: space ? '100%' : '50%' }} /></div>
      {space ? <People space={space} error={error} busy={busy} /> : <Name me={me} error={error} busy={busy} />}
    </div>
  )
}

function Name({ me, error, busy }: { me: { name: string; color: string; image: string | null }; error?: string; busy: boolean }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  return (
    <div className="onb-body">
      <Form method="post" className="onb-form">
        <input type="hidden" name="intent" value="space" />
        <p className="muted">Welcome, {me.name.split(' ')[0]}.</p>
        <h1>What are you working on?</h1>
        <p className="onb-lede">Give it a name. A space holds one piece of work: its ideas, the discussions that decide them, and the documents that come out of it.</p>
        <label className="onb-label">Space name
          <input name="name" required maxLength={60} autoFocus autoComplete="off" value={name} readOnly={busy} onChange={(e) => setName(e.target.value)} placeholder="Q4 launch" />
        </label>
        <label className="onb-label"><span>Description <span className="field-optional">Optional</span></span>
          <input name="description" maxLength={140} value={description} readOnly={busy} onChange={(e) => setDescription(e.target.value)} placeholder="What are you working toward?" />
        </label>
        <p className="onb-examples"><span className="muted">For example</span>{examples.map((x) => <button key={x} type="button" onClick={() => setName(x)}>{x}</button>)}</p>
        {error && <p className="error" role="alert">{error}</p>}
        <p className="onb-actions"><button className="primary big" disabled={busy} aria-busy={busy}>{busy ? 'Creating…' : 'Create space'}</button><span className="muted">Includes a welcome document to try.</span></p>
      </Form>
      <figure className="onb-preview" aria-hidden="true">
        <div className="onb-window">
          <p className="muted small">Home / {name || 'Your space'}</p>
          <p className="onb-name">{name || 'Your space'}<span className="caret" /></p>
          <p className="muted small onb-who"><Avatar name={me.name} color={me.color} image={me.image} size={20} />1 member · only members can open it</p>
          <p className="onb-tabs"><b>Overview</b><span>Ideas</span><span>Discussions</span><span>Documents</span><span>Decisions</span></p>
          <span className="bone w38" /><span className="bone w82" /><span className="bone w64" />
        </div>
        <figcaption className="muted">Your space, as it will look.</figcaption>
      </figure>
    </div>
  )
}

function People({ space, error, busy }: { space: { id: string; name: string }; error?: string; busy: boolean }) {
  const [rows, setRows] = useState([{ key: 0, email: '' }])
  const filled = rows.filter((r) => r.email.trim()).length
  const set = (key: number, email: string) => setRows(rows.map((r) => (r.key === key ? { ...r, email } : r)))
  return (
    <div className="onb-body">
      <Form method="post" className="onb-form">
        <input type="hidden" name="space" value={space.id} />
        <h1>Who works on {space.name} with you?</h1>
        <p className="onb-lede">This step is optional. Add them by the email they use for CoWrite, or continue on your own. You can change anyone's role later.</p>
        {rows.map((r, i) => (
          <div className="onb-person" key={r.key}>
            <input name="email" type="email" aria-label={`Email ${i + 1}`} placeholder="name@example.com" autoFocus={i === 0} value={r.email} onChange={(e) => set(r.key, e.target.value)} />
            <select name="role" aria-label={`Role ${i + 1}`} defaultValue="editor">{roles.map(([role]) => <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}</option>)}</select>
            <button type="button" className="ghost" aria-label={`Remove ${r.email || `row ${i + 1}`}`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>×</button>
          </div>
        ))}
        <button type="button" className="onb-add" onClick={() => setRows([...rows, { key: Math.max(...rows.map((x) => x.key)) + 1, email: '' }])}>+ Add another person</button>
        <p className="onb-note">They need a CoWrite account first. No email is sent yet, so tell them yourself, or share the space's link later from Share.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <p className="onb-actions"><button className="primary big" disabled={busy} aria-busy={busy}>{busy ? 'Adding…' : filled ? `Add ${filled === 1 ? '1 person' : `${filled} people`} and continue` : 'Continue'}</button></p>
      </Form>
      <aside className="onb-roles" aria-labelledby="roles-title">
        <h2 id="roles-title">What each role can do</h2>
        {roles.map(([role, can]) => <p key={role}><b>{role[0].toUpperCase() + role.slice(1)}</b><span>{can}</span></p>)}
      </aside>
    </div>
  )
}
