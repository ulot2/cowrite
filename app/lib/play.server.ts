import { requireDocument } from './access.server'

// The playground: one page per browser to try CoWrite without an account. Its id lives in the
// `play` cookie, and only the browser that holds it can open the page. The object's room is
// "play:<id>"; in URLs the page is "play-<id>", so it fits where a document id goes.
export const PLAY_DAYS = 7

export const playId = (request: Request) => request.headers.get('cookie')?.match(/(?:^|;\s*)play=([\w-]+)/)?.[1] ?? null

export const playCookie = (id: string, request: Request) =>
  `play=${id}; Path=/; Max-Age=${PLAY_DAYS * 86400}; HttpOnly; SameSite=Lax${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`

// A page that export, print, and slides can read: a document the person may open, or their own
// playground. `room` is the object's name, `back` the page to return to.
export const requireReadable = async (request: Request, id: string) => {
  if (id.startsWith('play-')) {
    if (id.slice(5) !== playId(request)) throw new Response('Not found', { status: 404 })
    return { title: 'Playground', room: `play:${id.slice(5)}`, back: '/play' }
  }
  const { document } = await requireDocument(request, id)
  return { title: document.title, room: id, back: `/doc/${id}` }
}
