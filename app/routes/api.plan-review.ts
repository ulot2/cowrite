import { requireUser } from '~/lib/auth.server'
import { confirmPlanReview, loadPlanReview } from '~/lib/plan-reviews.server'
import { validPlanId } from '~/lib/decision-plan'
import type { Route } from './+types/api.plan-review'

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } })
async function failure(error: unknown) {
  if (error instanceof Response && (error.status === 403 || error.status === 404)) return json({ error: error.status === 404 ? 'This plan or decision is no longer available to you.' : await error.text() }, error.status)
  console.error('Plan review unavailable', error)
  return json({ error: 'The review could not be loaded or saved. Your plan is unchanged. Try again.' }, 503)
}
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request), params = new URL(request.url).searchParams
  const decision = params.get('decision') || '', plan = params.get('plan') || ''
  if (!decision || decision.length > 250 || !validPlanId(plan)) return json({ error: 'Choose a valid plan to review.' }, 400)
  try { return json({ review: await loadPlanReview(user.id, decision, plan) }) } catch (error) { return failure(error) }
}
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request), fields = await request.formData()
  try { return json(await confirmPlanReview(user.id, fields)) } catch (error) { return failure(error) }
}
