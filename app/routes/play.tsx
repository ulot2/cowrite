import { data, Link } from 'react-router'
import { docStub } from '~/lib/versions.server'
import { PLAY_DAYS, playCookie, playId } from '~/lib/play.server'
import { Editor } from '~/components/editor'
import { MoreMenu } from '~/components/more-menu'
import { Mark } from '~/components/logo'
import type { Route } from './+types/play'

export const meta = () => [{ title: 'Playground · cowrite' }, { name: 'robots', content: 'noindex' }]

// Try CoWrite without an account: one page per browser, filled on the first visit. Each visit
// renews the cookie; the page itself goes a week after its last edit (see the object's alarm).
// ponytail: anyone can make a page per visit; they are small and delete themselves. Rate-limit if abused.
export async function loader({ request }: Route.LoaderArgs) {
  const id = playId(request) ?? crypto.randomUUID()
  await docStub(`play:${id}`).seed('play')
  return data({ id: `play-${id}`, days: PLAY_DAYS }, { headers: { 'Set-Cookie': playCookie(id, request) } })
}

// The editor reports accepted and rejected suggestions to the page it is on. Nobody to tell here.
export const action = () => null

const guest = { id: 'guest', name: 'You', color: '#2e7d32' }

export default function Play({ loaderData }: Route.ComponentProps) {
  const { id, days } = loaderData
  return (
    <main className="play">
      <article className="document">
        <Editor documentId={id} user={guest} canEdit canComment={false} canSuggest mustSuggest={false} canResolve nib={false} people={[]}
          crumbs={<div className="doc-where"><Link to="/" className="brand"><Mark /><span>cowrite</span></Link><span className="play-tag">Playground</span></div>}
          actions={<>
            <div className="tool-group" role="group" aria-label="Page"><MoreMenu documentId={id} /></div>
            <Link className="tool play-cta" to="/login?mode=up">Sign up free</Link>
          </>}>
          <h1 className="title">Playground</h1>
          <p className="play-note">Only you can see this page. It stays in this browser for {days} days after your last edit.</p>
        </Editor>
      </article>
    </main>
  )
}
