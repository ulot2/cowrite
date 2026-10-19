import { requireUser } from '~/lib/auth.server'
import { connectedWork, changeConnection } from '~/lib/connections.server'
import { parseWorkRef } from '~/lib/connections'
import type { Route } from './+types/api.connections'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
async function failure(error: unknown) {
  if (error instanceof Response && (error.status === 403 || error.status === 404)) return json({ error: error.status === 404 ? 'This item is no longer available, or you do not have access to it.' : await error.text() }, error.status)
  throw error
}
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request), params = new URL(request.url).searchParams
  const ref = parseWorkRef(params.get('kind'), params.get('id'))
  if (!ref) return json({ error: 'Choose a valid work item.' }, 400)
  try { return json(await connectedWork(user.id, ref)) } catch (e) { return failure(e) }
}
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request), fields = await request.formData()
  const ref = parseWorkRef(fields.get('kind'), fields.get('id'))
  if (!ref) return json({ error: 'Choose a valid work item.' }, 400)
  try { return json(await changeConnection(user.id, ref, fields)) } catch (e) { return failure(e) }
}
