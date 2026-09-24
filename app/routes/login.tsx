import { useState } from 'react'
import { Link, redirect, useNavigate, useSearchParams } from 'react-router'
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

const GitHub = () => (
  <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
)

// An open eye shows the password; a struck-through one hides it again.
const Eye = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
    {!open && <path d="M4 4l16 16" />}
  </svg>
)

export default function Login({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') ?? '/'
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/' // only paths on this site
  // A new account goes through the welcome steps, unless it came here on its way somewhere (a share link).
  const firstStop = params.has('next') ? target : '/welcome'
  // "Start a space" on the landing page links here with ?mode=up, to open on sign-up.
  const [mode, setMode] = useState<'in' | 'up'>(params.get('mode') === 'up' ? 'up' : 'in')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState(false)
  const up = mode === 'up'

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setBusy(true); setError('')
    const f = new FormData(e.currentTarget)
    const email = String(f.get('email')), password = String(f.get('password'))
    const result = up
      ? await authClient.signUp.email({ email, password, name: String(f.get('name')) })
      : await authClient.signIn.email({ email, password })
    setBusy(false)
    if (result.error) setError(result.error.message ?? 'That did not work. Check the email and the password.')
    else navigate(up ? firstStop : target)
  }
  const switchTo = (m: 'in' | 'up') => { setMode(m); setError('') }

  return (
    <main className="login">
      <section className="login-intro">
        <Link to="/" className="brand"><Mark size={32} /><span>cowrite</span></Link>
        <div className="login-pitch">
          <h1>Every decision, <span>with the conversation that made it.</span></h1>
          <p className="lead">Ideas, discussions, decisions, and documents in one space, linked both ways.</p>
        </div>
        <figure className="login-card" aria-hidden="true">
          <p className="login-card-top"><span className="login-num">D-4</span><span className="login-state">Decided</span></p>
          <p className="login-card-title">Launch on April 10</p>
          <div className="login-why">
            <p className="muted small">Why · from #launch</p>
            <p><b>Ade</b> Did we say March 3 or April 10?</p>
            <p><b>Tom</b> April 10, after the security review.</p>
          </div>
        </figure>
        <p className="muted small">Free and open source.</p>
      </section>

      <form className="card-form" onSubmit={submit}>
        <div className="login-switch" role="group" aria-label="Sign in or create an account" data-mode={mode}>
          <button type="button" aria-pressed={!up} onClick={() => switchTo('in')}>Sign in</button>
          <button type="button" aria-pressed={up} onClick={() => switchTo('up')}>Create account</button>
        </div>
        <div className="login-head" key={mode}>
          <h2>{up ? 'Create your account' : 'Welcome back'}</h2>
          <p className="muted small">{up ? 'Then name your first space. It takes about a minute.' : 'Sign in to pick up where you left off.'}</p>
        </div>
        {loaderData.github && (
          <>
            <button type="button" className="login-github" onClick={() => authClient.signIn.social({ provider: 'github', callbackURL: target, newUserCallbackURL: firstStop })}>
              <GitHub />Continue with GitHub
            </button>
            <div className="divider">or with email</div>
          </>
        )}
        {/* The sign-up fields fold open and shut. Shut, they are disabled: not sent, not required. */}
        <div className="reveal" data-open={up || undefined} inert={!up}><div><label>Name<input name="name" required disabled={!up} autoComplete="name" /></label></div></div>
        <label>Email<input name="email" type="email" required autoComplete="email" /></label>
        <label>Password
          <span className="password">
            <input name="password" type={show ? 'text' : 'password'} required minLength={8} autoComplete={up ? 'new-password' : 'current-password'} aria-describedby={up ? 'password-hint' : undefined} />
            <button type="button" className="ghost eye" aria-label="Show password" title={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow(!show)}><Eye open={!show} /></button>
          </span>
        </label>
        <div className="reveal hint" data-open={up || undefined} inert={!up}><div><p id="password-hint" className="muted small">At least 8 characters.</p></div></div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary big" type="submit" disabled={busy} aria-busy={busy}>
          {busy ? (up ? 'Creating your account…' : 'Signing in…') : up ? 'Create account' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
