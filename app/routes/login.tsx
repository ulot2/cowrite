import { useState } from 'react'
import { redirect, useNavigate, useSearchParams } from 'react-router'
import { env } from 'cloudflare:workers'
import { getAuth } from '~/lib/auth.server'
import { authClient } from '~/lib/auth.client'
import { Mark } from '~/components/logo'
import type { Route } from './+types/login'

export const meta = () => [{ title: 'Sign in · cowrite' }]

// Already signed in: skip the page. Also tells the page whether GitHub login exists here.
export async function loader({ request }: Route.LoaderArgs) {
  if (await getAuth().api.getSession({ headers: request.headers })) throw redirect('/')
  return { github: Boolean(env.GITHUB_CLIENT_ID) }
}

export default function Login({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') ?? '/'
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/' // only paths on this site
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setBusy(true); setError('')
    const f = new FormData(e.currentTarget)
    const email = String(f.get('email')), password = String(f.get('password'))
    const result = mode === 'up'
      ? await authClient.signUp.email({ email, password, name: String(f.get('name')) })
      : await authClient.signIn.email({ email, password })
    setBusy(false)
    if (result.error) setError(result.error.message ?? 'That did not work. Check the email and the password.')
    else navigate(target)
  }

  return (
    <main className="login">
      <section className="login-intro">
        <span className="brand"><Mark size={32} /><span>cowrite</span></span>
        <h1>Write together, in the same place, at the same time.</h1>
        <p className="lead">One document, everyone's cursor, and no lost edits when a connection drops.</p>
      </section>
      <form className="card-form" onSubmit={submit}>
        <h2>{mode === 'in' ? 'Sign in' : 'Create your account'}</h2>
        {loaderData.github && (
          <>
            <button type="button" onClick={() => authClient.signIn.social({ provider: 'github', callbackURL: target })}>Continue with GitHub</button>
            <div className="divider">or with email</div>
          </>
        )}
        {mode === 'up' && <label>Name<input name="name" required autoComplete="name" /></label>}
        <label>Email<input name="email" type="email" required autoComplete="email" /></label>
        <label>Password<input name="password" type="password" required minLength={8} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={busy}>{mode === 'in' ? 'Sign in' : 'Create account'}</button>
        <button className="ghost" type="button" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError('') }}>
          {mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
      </form>
    </main>
  )
}
