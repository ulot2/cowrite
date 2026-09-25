import { useEffect, useState } from 'react'
import { Form, Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { authClient } from '~/lib/auth.client'
import { listSpaces } from '~/lib/access.server'
import { Avatar } from '~/components/avatar'
import { Icon } from '~/components/icon'
import { Inbox } from '~/components/inbox'
import { NewMenu } from '~/components/new-menu'
import { Logo } from '~/components/logo'
import type { Route } from './+types/shell'

export type ShellUser = { id: string; name: string; email: string; color: string; image: string | null }

// Runs for every page inside the shell: who is signed in.
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  return { user: { id: user.id, name: user.name, email: user.email, color: user.color, image: user.image ?? null } satisfies ShellUser, spaces: await listSpaces(user.id) }
}

// Reads and writes the per-browser preferences. They are conveniences, so failures are ignored.
const pref = {
  get: (key: string) => { try { return localStorage.getItem(key) } catch { return null } },
  set: (key: string, value: string) => { try { localStorage.setItem(key, value) } catch { /* private window */ } },
}

export default function Shell({ loaderData }: Route.ComponentProps) {
  const { user, spaces } = loaderData
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [open, setOpen] = useState(false) // phone drawer
  const [collapsed, setCollapsed] = useState(false) // desktop rail

  // Preferences load after the first paint, so the server and the browser render the same HTML.
  // The settings page can change the sidebar too; it says so with a "prefs" event.
  useEffect(() => {
    const read = () => setCollapsed(document.documentElement.dataset.sidebar === 'collapsed')
    read()
    addEventListener('prefs', read)
    return () => removeEventListener('prefs', read)
  }, [])
  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next); pref.set('sidebar', next ? 'collapsed' : 'open')
    if (next) document.documentElement.dataset.sidebar = 'collapsed'; else delete document.documentElement.dataset.sidebar
  }

  return (
    <div className="shell">
      <header className="topbar">
        <button className="ghost menu" type="button" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(!open)}><Icon name="menu" /><span className="sr-only">Menu</span></button>
        <Form method="get" action="/documents" className="search" role="search">
          <Icon name="search" />
          <input name="q" type="search" placeholder="Search documents" aria-label="Search documents" defaultValue={params.get('q') ?? ''} />
        </Form>
        <div className="topbar-right">
          <NewMenu />
          <Inbox />
          <details className="account">
            <summary aria-label="Account menu"><Avatar name={user.name} color={user.color} image={user.image} size={32} /></summary>
            <div className="popover">
              <p className="who"><strong>{user.name}</strong><span>{user.email}</span></p>
              <Link className="ghost button menu-item" to="/settings"><Icon name="settings" />Settings</Link>
              <button className="ghost menu-item" type="button" onClick={async () => { await authClient.signOut(); navigate('/login') }}><Icon name="back" />Sign out</button>
            </div>
          </details>
        </div>
      </header>

      <nav id="sidebar" className="sidebar" data-open={open} aria-label="Main">
        <div className="side-head">
          <NavLink to="/" className="brand" onClick={() => setOpen(false)}><Logo /></NavLink>
          <button className="ghost collapse" type="button" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand' : 'Collapse'}>
            <Icon name={collapsed ? 'expand' : 'collapse'} />
          </button>
        </div>
        <NavLink to="/" end onClick={() => setOpen(false)}><Icon name="home" /><span>Home</span></NavLink>
        <NavLink to="/documents" onClick={() => setOpen(false)}><Icon name="docs" /><span>Documents</span></NavLink>
        <NavLink to="/tasks" onClick={() => setOpen(false)}><Icon name="tasks" /><span>Tasks</span></NavLink>
        <NavLink to="/review" onClick={() => setOpen(false)}><Icon name="suggest" /><span>Review</span></NavLink>
        <p className="side-heading"><span>Spaces</span></p>
        {spaces.map((s) => <NavLink key={s.id} to={`/space/${s.id}`} onClick={() => setOpen(false)}><Icon name="space" /><span>{s.name}</span></NavLink>)}
        <Form method="post" action="/?index" className="new-space">
          <input type="hidden" name="intent" value="new-space" />
          <input name="name" placeholder="New space" aria-label="New space name" maxLength={60} required />
          <button className="ghost" aria-label="Create space"><Icon name="plus" /></button>
        </Form>
        <NavLink to="/settings" className="side-settings" onClick={() => setOpen(false)}><Icon name="settings" /><span>Settings</span></NavLink>
      </nav>
      <div className="backdrop" hidden={!open} onClick={() => setOpen(false)} />

      <main className="content">
        <Outlet context={user} />
      </main>
    </div>
  )
}
