import { useState } from 'react'
import { Form, NavLink, Outlet, useNavigate } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { authClient } from '~/lib/auth.client'
import { listDocuments } from '~/lib/db.server'
import { colorFor } from '~/lib/color'
import { Avatar } from '~/components/avatar'
import type { Route } from './+types/shell'

// Runs for every page inside the shell: who is signed in, and their documents for the sidebar.
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  return { user: { id: user.id, name: user.name, color: colorFor(user.id) }, documents: await listDocuments(user.id) }
}

export default function Shell({ loaderData }: Route.ComponentProps) {
  const { user, documents } = loaderData
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  return (
    <div className="shell">
      <button className="menu quiet" type="button" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(!open)}>Menu</button>
      <nav id="sidebar" className="sidebar" data-open={open} aria-label="Main">
        <NavLink to="/" className="brand" onClick={() => setOpen(false)}>cowrite</NavLink>
        <Form method="post" action="/?index">
          <button className="wide" name="intent" value="create">New document</button>
        </Form>
        <p className="side-heading">Documents</p>
        <ul className="side-list">
          {documents.map((d) => (
            <li key={d.id}><NavLink to={`/doc/${d.id}`} onClick={() => setOpen(false)}>{d.title}</NavLink></li>
          ))}
        </ul>
        <details className="account">
          <summary><Avatar name={user.name} color={user.color} size={26} /><span className="truncate">{user.name}</span></summary>
          <button className="quiet wide" type="button" onClick={async () => { await authClient.signOut(); navigate('/login') }}>Sign out</button>
        </details>
      </nav>
      <div className="backdrop" hidden={!open} onClick={() => setOpen(false)} />
      <main className="content">
        <Outlet context={user} />
      </main>
    </div>
  )
}
