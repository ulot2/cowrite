import { createRequestHandler } from 'react-router'
import { getAuth } from '~/lib/auth.server'
import { roleOf } from '~/lib/db.server'

// The Doc class must be exported from the Worker entry, so Cloudflare can find it.
export { Doc } from './doc'

const requestHandler = createRequestHandler(() => import('virtual:react-router/server-build'), import.meta.env.MODE)

export default {
  async fetch(request, env) {
    // /ws/<id>: the editor's WebSocket. Checked once here, then handed to the document's object.
    const match = new URL(request.url).pathname.match(/^\/ws\/([\w-]+)$/)
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
