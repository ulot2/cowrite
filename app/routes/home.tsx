import { Form, Link, redirect } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { createDocument, listDocuments } from '~/lib/db.server'
import { createSpace } from '~/lib/access.server'
import { colorFor } from '~/lib/color'
import { DocCard } from '~/components/doc-card'
import { Icon } from '~/components/icon'
import type { Route } from './+types/home'

export const meta = () => [{ title: 'Home · cowrite' }]

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const recent = await listDocuments(user.id, { limit: 6 })
  return { firstName: user.name.split(' ')[0], owner: { name: user.name, color: colorFor(user.id) }, recent }
}

// "New document" from anywhere posts here: create it and open it.
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request)
  const f = await request.formData()
  const intent = f.get('intent')
  if (intent === 'new-space') {
    const name = String(f.get('name') ?? '').trim().slice(0, 60)
    if (name) throw redirect(`/space/${await createSpace(user.id, name)}`)
    return null
  }
  if (intent !== 'create') return null
  const title = String(f.get('title') ?? '').trim().slice(0, 120)
  throw redirect(`/doc/${await createDocument(user.id, title || 'Untitled')}`)
}

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }

export default function Home({ loaderData }: Route.ComponentProps) {
  const { firstName, owner, recent } = loaderData
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{greeting()}, {firstName}</h1>
          <p className="muted">{recent.length === 0 ? 'Your documents will show up here.' : 'Pick up where you left off.'}</p>
        </div>
      </header>
      {recent.length === 0 ? (
        <section className="empty">
          <h2>Start your first document</h2>
          <p className="muted">Write alone, or open the same document in two places and watch it stay in sync.</p>
          <Form method="post"><button className="primary" name="intent" value="create"><Icon name="plus" />New document</button></Form>
        </section>
      ) : (
        <>
          <div className="section-head"><h2>Recent</h2><Link to="/documents">All documents</Link></div>
          <div className="cards">
            {recent.map((d, i) => <DocCard key={d.id} doc={d} owner={owner} index={i} />)}
          </div>
        </>
      )}
    </div>
  )
}
