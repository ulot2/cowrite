import { betterAuth } from 'better-auth'
import { env } from 'cloudflare:workers'
import { redirect } from 'react-router'
import { colorFor } from './color'
import { getSettings, type Settings } from './settings.server'

// One Better Auth instance per Worker isolate. env.DB is the D1 binding; Better Auth reads and
// writes the four tables from migrations/0001_auth.sql through it.
const createAuth = () => betterAuth({
  database: env.DB,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: true },
  // GitHub login appears only when the two secrets are set (production). Local dev uses email.
  socialProviders: env.GITHUB_CLIENT_ID
    ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET ?? '' } }
    : {},
  // A signed-in person can connect GitHub from Settings even when its email differs from theirs.
  account: { accountLinking: { enabled: true, allowDifferentEmails: true } },
})
let auth: ReturnType<typeof createAuth> | undefined
export const githubEnabled = () => !!env.GITHUB_CLIENT_ID
export const getAuth = () => (auth ??= createAuth())

// The signed-in person with their avatar color resolved and their settings.
export type User = { id: string; name: string; email: string; image?: string | null; color: string; settings: Settings }

// Reads the session cookie. No session: send the browser to /login.
export const requireUser = async (request: Request): Promise<User> => {
  const session = await getAuth().api.getSession({ headers: request.headers })
  if (!session) throw redirect('/login')
  const settings = await getSettings(session.user.id)
  return { ...session.user, color: colorFor(session.user.id, settings.color), settings }
}
