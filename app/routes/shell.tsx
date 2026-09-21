import { useEffect, useState } from 'react'
import { Form, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { authClient } from '~/lib/auth.client'
import { colorFor } from '~/lib/color'
import { Avatar } from '~/components/avatar'
import { Icon } from '~/components/icon'
import { Mark } from '~/components/logo'
import type { Route } from './+types/shell'

export type ShellUser = { id: string; name: string; email: string; color: string }

// Runs for every page inside the shell: who is signed in.
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  return { user: { id: user.id, name: user.name, email: user.email, color: colorFor(user.id) } satisfies ShellUser }
}

type Theme = 'system' | 'light' | 'dark'
const themes: Theme[] = ['system', 'light', 'dark']

// Reads and writes the two per-browser preferences. Both are conveniences, so failures are ignored.
const pref = {
  get: (key: string) => { try { return localStorage.getItem(key) } catch { return null } },
  set: (key: string, value: string) => { try { localStorage.setItem(key, value) } catch { /* private window */ } },
}

export default function Shell({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [open, setOpen] = useState(false) // phone drawer
  const [collapsed, setCollapsed] = useState(false) // desktop rail
  const [theme, setTheme] = useState<Theme>('system')

  // Preferences load after the first paint, so the server and the browser render the same HTML.
  useEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebar === 'collapsed')
    setTheme((pref.get('theme') as Theme) || 'system')
  }, [])
  const chooseTheme = (t: Theme) => {
    setTheme(t); pref.set('theme', t)
    if (t === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = t
  }
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
          <Form method="post" action="/?index"><button className="primary" name="intent" value="create"><Icon name="plus" />New document</button></Form>
          <details className="account">
            <summary aria-label="Account menu"><Avatar name={user.name} color={user.color} size={32} /></summary>
            <div className="popover">
              <p className="who"><strong>{user.name}</strong><span>{user.email}</span></p>
              <fieldset className="theme">
                <legend>Theme</legend>
                {themes.map((t) => (
                  <label key={t}><input type="radio" name="theme" value={t} checked={theme === t} onChange={() => chooseTheme(t)} />{t[0].toUpperCase() + t.slice(1)}</label>
                ))}
              </fieldset>
              <button className="ghost" type="button" onClick={async () => { await authClient.signOut(); navigate('/login') }}>Sign out</button>
            </div>
          </details>
        </div>
      </header>

      <nav id="sidebar" className="sidebar" data-open={open} aria-label="Main">
        <div className="side-head">
          <NavLink to="/" className="brand" onClick={() => setOpen(false)}><Mark /><span>cowrite</span></NavLink>
          <button className="ghost collapse" type="button" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand' : 'Collapse'}>
            <Icon name={collapsed ? 'expand' : 'collapse'} />
          </button>
        </div>
        <NavLink to="/" end onClick={() => setOpen(false)}><Icon name="home" /><span>Home</span></NavLink>
        <NavLink to="/documents" onClick={() => setOpen(false)}><Icon name="docs" /><span>Documents</span></NavLink>
      </nav>
      <div className="backdrop" hidden={!open} onClick={() => setOpen(false)} />

      <main className="content">
        <Outlet context={user} />
      </main>
    </div>
  )
}
