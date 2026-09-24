import { useEffect } from 'react'
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'
import type { Route } from './+types/root'
import blocknoteCss from '@blocknote/mantine/style.css?url'
import './app.css'

export const links: Route.LinksFunction = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Instrument+Serif:ital@1&display=swap' },
  { rel: 'stylesheet', href: blocknoteCss },
  { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
]

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* Applies the saved theme, sidebar state, and text size before the first paint, so nothing flashes or jumps. */}
        <script dangerouslySetInnerHTML={{ __html: "try{var d=document.documentElement,t=localStorage.getItem('theme');if(t==='light'||t==='dark')d.dataset.theme=t;if(localStorage.getItem('sidebar')==='collapsed')d.dataset.sidebar='collapsed';var s=localStorage.getItem('textSize');if(s==='small'||s==='large')d.dataset.textSize=s}catch(e){}" }} />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

// Every menu in the app is a native <details>, which only closes from its own button. Make them
// behave like menus: a click or tap outside, Escape, or picking an item closes the open one.
const useMenusClose = () => {
  useEffect(() => {
    const open = () => [...document.querySelectorAll<HTMLDetailsElement>('details[open]')]
    const outside = (e: PointerEvent) => { for (const d of open()) if (!d.contains(e.target as Node)) d.open = false }
    const picked = (e: MouseEvent) => {
      // The path is kept from the moment of the click, so an item that its own click removed still counts.
      const path = e.composedPath().filter((n): n is HTMLElement => n instanceof HTMLElement)
      const item = path.find((n) => n.matches('a, button'))
      const menu = path.find((n): n is HTMLDetailsElement => n instanceof HTMLDetailsElement && n.open)
      if (menu && item && !path.some((n) => n.tagName === 'SUMMARY')) setTimeout(() => { menu.open = false }) // after the click has done its job
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      for (const d of open()) { d.open = false; d.querySelector('summary')?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('click', picked)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('click', picked); document.removeEventListener('keydown', escape) }
  }, [])
}

export default function App() {
  useMenusClose()
  return <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404
  return (
    <main className="page page-narrow">
      <span className="brand">cowrite</span>
      <h1>{notFound ? 'Not found' : 'Something went wrong'}</h1>
      <p className="lead">{notFound ? 'That document does not exist, or you have no access to it.' : 'Reload the page, or go back to your documents.'}</p>
      <p><a href="/documents">Your documents</a></p>
    </main>
  )
}
