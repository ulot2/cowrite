import { getAuth } from '~/lib/auth.server'
import type { Route } from './+types/api.auth'

// Every /api/auth/* request (sign in, sign up, session, OAuth callback) goes to Better Auth.
export const loader = ({ request }: Route.LoaderArgs) => getAuth().handler(request)
export const action = ({ request }: Route.ActionArgs) => getAuth().handler(request)
