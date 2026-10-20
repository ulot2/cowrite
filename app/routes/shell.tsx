import { useEffect, useRef, useState } from 'react'
import { Form, Link, NavLink, Outlet, useLocation, useNavigate, useRouteLoaderData, useSearchParams } from 'react-router'
import { requireUser } from '~/lib/auth.server'
import { authClient } from '~/lib/auth.client'
import { listSpaces } from '~/lib/access.server'
import { Avatar } from '~/components/avatar'
import { Icon } from '~/components/icon'
import { Inbox } from '~/components/inbox'
import { NewMenu } from '~/components/new-menu'
import { Logo } from '~/components/logo'
import { SpaceMark } from '~/components/space-mark'
import { CreateSpaceDialog } from '~/components/create-space'
import { spaceSections, spaceTab } from '~/lib/space-navigation'
import type { Route } from './+types/shell'
import type { loader as docLoader } from './doc'
import type { loader as historyLoader } from './history'
import type { loader as decisionLoader } from './decision'

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
  const [creating, setCreating] = useState(false)
  const [pinned, setPinned] = useState<string[]>([])
  const [mobile, setMobile] = useState(false)
  const sidebar = useRef<HTMLElement>(null)
  const menu = useRef<HTMLButtonElement>(null)
  const pinFocus = useRef<string | null>(null)
  const location = useLocation()
  const doc = useRouteLoaderData<typeof docLoader>('routes/doc')
  const history = useRouteLoaderData<typeof historyLoader>('routes/history')
  const decision = useRouteLoaderData<typeof decisionLoader>('routes/decision')
  const activeSpace = /^\/space\/([^/]+)/.exec(location.pathname)?.[1] ?? doc?.document.space_id ?? history?.document.space_id ?? decision?.decision.space_id
  const activeTab = doc || history ? 'documents' : decision ? 'decisions' : spaceTab(params.get('tab'))
  const pinKey = `cowrite:pinned-spaces:v1:${user.id}`

  useEffect(() => {
    const read = () => {
      try {
        const value: unknown = JSON.parse(pref.get(pinKey) ?? '[]')
        setPinned(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [])
      } catch { setPinned([]) }
    }
    read()
    const changed = (e: StorageEvent) => { if (e.key === pinKey || e.key === null) read() }
    addEventListener('storage', changed)
    return () => removeEventListener('storage', changed)
  }, [pinKey])

  useEffect(() => {
    if (!pinFocus.current) return
    const button = [...(sidebar.current?.querySelectorAll<HTMLButtonElement>('[data-space-pin]') ?? [])].find((el) => el.dataset.spacePin === pinFocus.current)
    button?.focus()
    pinFocus.current = null
  }, [pinned])

  useEffect(() => {
    const media = matchMedia('(max-width: 767px)')
    const read = () => { setMobile(media.matches); if (!media.matches) setOpen(false) }
    read(); media.addEventListener('change', read)
    return () => media.removeEventListener('change', read)
  }, [])

  useEffect(() => { setOpen(false) }, [location.key])

  useEffect(() => {
    if (!mobile || !open) return
    const nav = sidebar.current!
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    nav.querySelector<HTMLButtonElement>('.side-close')?.focus()
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
      if (e.key !== 'Tab') return
      const controls = [...nav.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')].filter((el) => el.getClientRects().length)
      const first = controls[0], last = controls.at(-1)
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keys)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', keys)
      if (nav.contains(document.activeElement)) menu.current?.focus()
    }
  }, [mobile, open])

  const togglePin = (id: string) => {
    pinFocus.current = id
    const next = pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id]
    setPinned(next); pref.set(pinKey, JSON.stringify(next))
  }
  const startSpace = () => { setOpen(false); setCreating(true) }

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
      <header className="topbar" inert={mobile && open}>
        <button ref={menu} className="ghost menu" type="button" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(!open)}><Icon name="menu" /><span className="sr-only">Menu</span></button>
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

      <aside ref={sidebar} id="sidebar" className="sidebar" data-open={open} aria-label="Main navigation" inert={mobile && !open} role={mobile && open ? 'dialog' : undefined} aria-modal={mobile && open ? true : undefined}>
        <div className="side-head">
          <NavLink to="/" className="brand" onClick={() => setOpen(false)}><Logo /></NavLink>
          <button className="ghost collapse" type="button" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand' : 'Collapse'}>
            <Icon name={collapsed ? 'expand' : 'collapse'} />
          </button>
          <button className="ghost side-close" type="button" aria-label="Close navigation" onClick={() => setOpen(false)}><Icon name="close" /></button>
        </div>
        <nav className="side-personal" aria-label="Your work">
          {([['/', 'Home', 'home'], ['/documents', 'Documents', 'docs'], ['/tasks', 'Tasks', 'tasks'], ['/review', 'Review', 'suggest']] as const).map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'} aria-label={label} title={label} onClick={() => setOpen(false)}><Icon name={icon} /><span className="side-label">{label}</span></NavLink>
          ))}
        </nav>
        <div className="side-spaces-head">
          <h2 className="side-heading" id="side-spaces-title">Spaces</h2>
          <button className="ghost side-create" type="button" onClick={startSpace} aria-label="New space" title="New space"><Icon name="plus" /></button>
        </div>
        <nav className="side-spaces-list" aria-label="Spaces">
          {spaces.length === 0 && <div className="side-empty"><p>Give your next project a home.</p><button type="button" className="ghost" onClick={startSpace}>Create your first space</button></div>}
          {[true, false].map((isPinned) => {
            const group = spaces.filter((s) => pinned.includes(s.id) === isPinned)
            if (!group.length) return null
            return <div className="side-space-group" key={String(isPinned)}>
              {pinned.some((id) => spaces.some((s) => s.id === id)) && <p className="side-group-label">{isPinned ? 'Pinned' : 'Other spaces'}</p>}
              {group.map((s) => <div className="side-space-item" key={s.id}>
                <div className="side-space-row">
                  <NavLink to={`/space/${s.id}`} className={activeSpace === s.id ? 'active' : ''} aria-label={s.name} title={s.name} onClick={() => setOpen(false)}><SpaceMark space={s} /><span className="side-label">{s.name}</span></NavLink>
                  <button className="ghost side-pin" type="button" data-space-pin={s.id} aria-pressed={isPinned} aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${s.name}`} title={`${isPinned ? 'Unpin' : 'Pin'} space`} onClick={() => togglePin(s.id)}><Icon name="pin" /></button>
                </div>
                {activeSpace === s.id && <div className="side-space-sections">
                  {spaceSections.map(([tab, label, icon]) => <Link key={tab} to={`/space/${s.id}${tab === 'overview' ? '' : `?tab=${tab}`}`} className={!location.pathname.endsWith('/settings') && activeTab === tab ? 'active' : ''} aria-current={!location.pathname.endsWith('/settings') && activeTab === tab ? 'page' : undefined} onClick={() => setOpen(false)}><Icon name={icon} /><span>{label}</span></Link>)}
                </div>}
              </div>)}
            </div>
          })}
        </nav>
        <NavLink to="/settings" className="side-settings" aria-label="Settings" title="Settings" onClick={() => setOpen(false)}><Icon name="settings" /><span className="side-label">Settings</span></NavLink>
      </aside>
      <div className="backdrop" hidden={!open} onClick={() => setOpen(false)} />

      <main className="content" inert={mobile && open}>
        <Outlet context={user} />
      </main>
      <CreateSpaceDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}
