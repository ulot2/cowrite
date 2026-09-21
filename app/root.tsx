import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'
import type { Route } from './+types/root'
import './app.css'

export const links: Route.LinksFunction = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Instrument+Serif:ital@1&display=swap' },
  { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
]

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* Applies the saved theme and sidebar state before the first paint, so nothing flashes or jumps. */}
        <script dangerouslySetInnerHTML={{ __html: "try{var d=document.documentElement,t=localStorage.getItem('theme');if(t==='light'||t==='dark')d.dataset.theme=t;if(localStorage.getItem('sidebar')==='collapsed')d.dataset.sidebar='collapsed'}catch(e){}" }} />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
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
