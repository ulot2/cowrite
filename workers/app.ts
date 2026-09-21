import { createRequestHandler } from 'react-router'
import { getAuth } from '~/lib/auth.server'
import { roleOf } from '~/lib/db.server'

// The Doc class must be exported from the Worker entry, so Cloudflare can find it.
export { Doc } from './doc'

const requestHandler = createRequestHandler(() => import('virtual:react-router/server-build'), import.meta.env.MODE)

const MAX_UPLOAD = 8 * 1024 * 1024

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)

    // POST /upload: an image from the editor. Session required. Stored in R2 under a random key.
    if (pathname === '/upload' && request.method === 'POST') {
      if (!(await getAuth().api.getSession({ headers: request.headers }))) return new Response('Sign in first', { status: 401 })
      const type = request.headers.get('content-type') ?? ''
      if (!type.startsWith('image/')) return new Response('Only images', { status: 415 })
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
      const { results } = await env.DB.prepare(`SELECT id, name, image FROM "user" WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string; name: string; image: string | null }>()
      return Response.json(results.map((u) => ({ id: u.id, username: u.name, avatarUrl: u.image ?? '' })))
    }

    // GET /files/<key>: serves an uploaded image. Keys are random, so the URL is the permission.
    if (pathname.startsWith('/files/') && request.method === 'GET') {
      const object = await env.FILES.get(pathname.slice(7))
      if (!object) return new Response('Not found', { status: 404 })
      return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream', etag: object.httpEtag, 'cache-control': 'public, max-age=31536000, immutable' } })
    }

    // /ws/<id>: the editor's WebSocket. Checked once here, then handed to the document's object.
    const match = pathname.match(/^\/ws\/([\w-]+)$/)
    if (match) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 })
      const session = await getAuth().api.getSession({ headers: request.headers })
      if (!session) return new Response('Sign in first', { status: 401 })
      const role = await roleOf(match[1], session.user.id)
      if (!role) return new Response('No access to this document', { status: 403 })
      const headers = new Headers(request.headers)
      headers.set('X-Role', role)
      return env.DOC.get(env.DOC.idFromName(match[1])).fetch(new Request(request, { headers }))
    }
    return requestHandler(request)
  },
} satisfies ExportedHandler<Env>
