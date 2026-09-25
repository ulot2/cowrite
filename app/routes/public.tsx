import { Link } from 'react-router'
import { getPublished } from '~/lib/db.server'
import { docStub } from '~/lib/versions.server'
import { ReadView } from '~/components/read-view'
import { Logo } from '~/components/logo'
import type { Route } from './+types/public'

export const meta = ({ loaderData }: Route.MetaArgs) => loaderData ? [
  { title: loaderData.title },
  { name: 'description', content: loaderData.description },
  { property: 'og:title', content: loaderData.title },
  { property: 'og:description', content: loaderData.description },
] : [{ title: 'Not found' }]

// /p/<slug>: a published document. No account needed. It shows the version saved at publish time,
// so edits made after that stay private until the owner updates the page.
export async function loader({ params }: Route.LoaderArgs) {
  const doc = await getPublished(params.slug)
  const blocks = doc && await docStub(doc.id).readRich(doc.published_version)
  if (!doc || !blocks) throw new Response('This page is not published', { status: 404 })
  return { title: doc.title, description: doc.preview.slice(0, 160), publishedAt: doc.published_at, blocks }
}

export default function Public({ loaderData }: Route.ComponentProps) {
  const { title, publishedAt, blocks } = loaderData
  return (
    <div className="public">
      <header className="public-bar">
        <Link to="/" className="brand"><Logo /></Link>
      </header>
      <main className="public-page">
        <h1 className="read-title">{title}</h1>
        <p className="muted small">Published {new Date(publishedAt).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        <ReadView blocks={blocks} />
      </main>
      <footer className="public-foot muted small">Written with <Link to="/">cowrite</Link></footer>
    </div>
  )
}
