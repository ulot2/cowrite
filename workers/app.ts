import { createRequestHandler } from 'react-router'
import { getAuth } from '~/lib/auth.server'
import { roleOnDocument, roleOnSpace } from '~/lib/access.server'
import { usersById } from '~/lib/db.server'
import { atLeast } from '~/lib/roles'
import { playId } from '~/lib/play.server'

// The Doc class must be exported from the Worker entry, so Cloudflare can find it.
export { Doc } from './doc'

const requestHandler = createRequestHandler(() => import('virtual:react-router/server-build'), import.meta.env.MODE)

const MAX_UPLOAD = 8 * 1024 * 1024

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)

    // "/" is the landing page for visitors, and home for people signed in. Only the cookie is
    // checked (no database call); a stale one falls through to home, which sends it to /login.
    if (pathname === '/' && request.method === 'GET' && !request.headers.get('cookie')?.includes('better-auth.session_token'))
      return env.ASSETS.fetch(new URL('/landing/', request.url))

    // POST /upload: an image from the editor. Session required. Stored in R2 under a random key.
    if (pathname === '/upload' && request.method === 'POST') {
      if (!(await getAuth().api.getSession({ headers: request.headers }))) return new Response('Sign in first', { status: 401 })
      const type = request.headers.get('content-type') ?? ''
      // No SVG: served from this origin, an SVG could run a script when opened on its own.
      if (!type.startsWith('image/') || type.includes('svg')) return new Response('Only PNG, JPEG, GIF, or WebP images', { status: 415 })
      const body = await request.arrayBuffer()
      if (body.byteLength > MAX_UPLOAD) return new Response('Images must be 8 MB or smaller', { status: 413 })
      const name = (request.headers.get('x-file-name') ?? 'image').replace(/[^\w.-]+/g, '-').slice(0, 80)
      const key = `${crypto.randomUUID()}/${name}`
      await env.FILES.put(key, body, { httpMetadata: { contentType: type } })
      return Response.json({ url: `/files/${key}` })
    }

    // GET /api/users?ids=a,b: names and avatars for the comments UI. Session required.
    if (pathname === '/api/users' && request.method === 'GET') {
      if (!(await getAuth().api.getSession({ headers: request.headers }))) return new Response('Sign in first', { status: 401 })
      const ids = (new URL(request.url).searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 50)
      if (ids.length === 0) return Response.json([])
      const ai = ids.includes('ai') ? [{ id: 'ai', username: 'Nib', avatarUrl: '' }] : []
      return Response.json([...ai, ...(await usersById(ids)).map((u) => ({ id: u.id, username: u.name, avatarUrl: u.image ?? '' }))])
    }

    // GET /files/<key>: serves an uploaded image. Keys are random, so the URL is the permission.
    if (pathname.startsWith('/files/') && request.method === 'GET') {
      const object = await env.FILES.get(pathname.slice(7))
      if (!object) return new Response('Not found', { status: 404 })
      return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream', etag: object.httpEtag, 'cache-control': 'public, max-age=31536000, immutable' } })
    }

    // /ws/space/<id>: the space's room (discussions and their tasks). Commenters and up write.
    const space = pathname.match(/^\/ws\/space\/([\w-]+)$/)
    if (space) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 })
      const session = await getAuth().api.getSession({ headers: request.headers })
      if (!session) return new Response('Sign in first', { status: 401 })
      const role = await roleOnSpace(session.user.id, space[1])
      if (!role) return new Response('No access to this space', { status: 403 })
      const headers = new Headers(request.headers)
      headers.set('X-Role', atLeast(role, 'commenter') ? 'editor' : 'viewer')
      headers.set('X-User', session.user.id)
      return env.DOC.get(env.DOC.idFromName(`${space[1]}:space`)).fetch(new Request(request, { headers }))
    }

    // /ws/play-<id>: a playground page. Only the browser whose `play` cookie holds the id may open
    // it, with no account. It writes the text; its comments room is read-only (the page has none).
    const play = pathname.match(/^\/ws\/play-([\w-]+)(\/threads)?$/)
    if (play) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 })
      if (play[1] !== playId(request)) return new Response('Not your playground', { status: 403 })
      const headers = new Headers(request.headers)
      headers.set('X-Role', play[2] ? 'viewer' : 'editor')
      headers.set('X-User', 'guest')
      return env.DOC.get(env.DOC.idFromName(`play:${play[1]}${play[2] ? ':threads' : ''}`)).fetch(new Request(request, { headers }))
    }

    // /ws/<id> is the text, /ws/<id>/threads the comments. Each is its own object with its own
    // write rule: text needs reviewer (their edits are suggestions, which the editor enforces),
    // comments need commenter. Below that, the socket can only read.
    const match = pathname.match(/^\/ws\/([\w-]+)(\/threads)?$/)
    if (match) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 })
      const session = await getAuth().api.getSession({ headers: request.headers })
      if (!session) return new Response('Sign in first', { status: 401 })
      const role = await roleOnDocument(session.user.id, match[1])
      if (!role) return new Response('No access to this document', { status: 403 })
      const room = match[2] ? `${match[1]}:threads` : match[1]
      const canWrite = atLeast(role, match[2] ? 'commenter' : 'reviewer')
      const headers = new Headers(request.headers)
      headers.set('X-Role', canWrite ? 'editor' : 'viewer')
      headers.set('X-User', session.user.id) // the object logs who edited
      return env.DOC.get(env.DOC.idFromName(room)).fetch(new Request(request, { headers }))
    }
    return requestHandler(request)
  },
} satisfies ExportedHandler<Env>
