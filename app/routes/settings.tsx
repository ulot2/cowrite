import { useEffect, useRef, useState } from 'react'
import { redirect, useFetcher } from 'react-router'
import { getAuth, githubEnabled, requireUser } from '~/lib/auth.server'
import { authClient } from '~/lib/auth.client'
import { colorFor, colors } from '~/lib/color'
import { deleteAccount, ownedCounts, saveSettings } from '~/lib/settings.server'
import { isKind, kinds, type Kind } from '~/lib/kinds'
import { Avatar } from '~/components/avatar'
import { Confirm } from '~/components/confirm'
import { Icon } from '~/components/icon'
import type { Route } from './+types/settings'

export const meta = () => [{ title: 'Settings · cowrite' }]

// "Chrome on Windows" from a user agent. Rough on purpose: it only has to tell your devices apart.
const deviceOf = (ua: string | null | undefined) => {
  const s = ua ?? ''
  const browser = /Edg\//.test(s) ? 'Edge' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /node|curl/i.test(s) ? 'A script' : 'A browser'
  const os = /iPhone|iPad/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : ''
  return os ? `${browser} on ${os}` : browser
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const auth = getAuth()
  const [accounts, sessions, current] = await Promise.all([
    auth.api.listUserAccounts({ headers: request.headers }),
    auth.api.listSessions({ headers: request.headers }),
    auth.api.getSession({ headers: request.headers }),
  ])
  return {
    user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null, color: user.color },
    settings: user.settings,
    hasPassword: accounts.some((a) => a.providerId === 'credential'),
    github: githubEnabled() ? accounts.some((a) => a.providerId === 'github') : null, // null: not set up on this server
    devices: sessions.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).map((s) => ({
      id: s.id, device: deviceOf(s.userAgent), at: +new Date(s.updatedAt), current: s.id === current?.session.id,
    })),
    owned: await ownedCounts(user.id),
  }
}

// Better Auth reports problems as errors with a message; show that message by the form.
const failed = (intent: string, e: unknown) => ({ intent, error: (e as { body?: { message?: string } })?.body?.message ?? (e instanceof Error ? e.message : 'Something went wrong. Try again.') })

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request)
  const auth = getAuth()
  const headers = request.headers
  const f = await request.formData()
  const intent = String(f.get('intent'))
  const done = { intent, ok: true as const }
  try {
    switch (intent) {
      case 'name': {
        const name = String(f.get('name') ?? '').trim()
        if (!name || name.length > 60) return { intent, error: 'Use a name of 1 to 60 characters.' }
        await auth.api.updateUser({ headers, body: { name } })
        return done
      }
      case 'photo': {
        // Only a file this app stored (from /upload), or nothing to remove the photo.
        const image = String(f.get('image') ?? '')
        if (image && !/^\/files\/[\w-]+\/[\w.-]+$/.test(image)) return { intent, error: 'That photo did not upload. Try again.' }
        await auth.api.updateUser({ headers, body: { image: image || null } })
        return done
      }
      case 'color': {
        const color = String(f.get('color') ?? '')
        await saveSettings(user.id, { color: colors.includes(color) ? color : null })
        return done
      }
      case 'password': {
        const next = String(f.get('new') ?? '')
        if (next.length < 8 || next.length > 128) return { intent, error: 'Use a password of 8 to 128 characters.' }
        if (next !== String(f.get('confirm') ?? '')) return { intent, error: 'The two new passwords are not the same.' }
        if (f.get('has') === '1') await auth.api.changePassword({ headers, body: { currentPassword: String(f.get('current') ?? ''), newPassword: next } })
        else await auth.api.setPassword({ headers, body: { newPassword: next } })
        if (f.get('others') === 'on') await auth.api.revokeOtherSessions({ headers })
        return done
      }
      case 'unlink-github': {
        const github = (await auth.api.listUserAccounts({ headers })).find((a) => a.providerId === 'github')
        if (github) await auth.api.unlinkAccount({ headers, body: { accountId: github.id } })
        return done
      }
      case 'sign-out-others':
        await auth.api.revokeOtherSessions({ headers })
        return done
      case 'notifications': {
        // The form sends the kinds that stay on; every other kind is muted.
        const on = new Set(f.getAll('kind').map(String))
        await saveSettings(user.id, { muted: (Object.keys(kinds) as Kind[]).filter((k) => !on.has(k)).filter(isKind) })
        return done
      }
      case 'nib':
        await saveSettings(user.id, { nib: f.get('nib') === 'on' })
        return done
      case 'delete-account':
        if (String(f.get('email') ?? '').trim().toLowerCase() !== user.email.toLowerCase()) return { intent, error: 'Type your email exactly to delete the account.' }
        await deleteAccount(user.id)
        throw redirect('/login')
    }
  } catch (e) {
    if (e instanceof Response) throw e
    return failed(intent, e)
  }
  return null
}

type Result = { intent: string; ok?: true; error?: string } | null | undefined

// The status line next to a form's button: "Saved", or what went wrong.
function Said({ fetcher, intent, ok = 'Saved' }: { fetcher: { state: string; data?: unknown }; intent: string; ok?: string }) {
  const data = fetcher.data as Result
  if (fetcher.state !== 'idle' || data?.intent !== intent) return null
  return data.error
    ? <p className="setting-said" data-error role="alert">{data.error}</p>
    : <p className="setting-said" role="status"><Icon name="check" />{ok}</p>
}

const pref = {
  get: (key: string) => { try { return localStorage.getItem(key) } catch { return null } },
  set: (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch { /* private window */ } },
}

// Three per-browser choices. They live in this browser (localStorage), not the account, so a phone
// and a laptop can differ. The root script applies them before the first paint.
function Appearance() {
  const [theme, setTheme] = useState('system')
  const [size, setSize] = useState('default')
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    setTheme(pref.get('theme') || 'system')
    setSize(pref.get('textSize') || 'default')
    setCompact(pref.get('sidebar') === 'collapsed')
  }, [])
  const root = () => document.documentElement
  const chooseTheme = (t: string) => {
    setTheme(t); pref.set('theme', t)
    if (t === 'system') delete root().dataset.theme; else root().dataset.theme = t
  }
  const chooseSize = (s: string) => {
    setSize(s); pref.set('textSize', s === 'default' ? null : s)
    if (s === 'default') delete root().dataset.textSize; else root().dataset.textSize = s
  }
  const chooseCompact = (on: boolean) => {
    setCompact(on); pref.set('sidebar', on ? 'collapsed' : 'open')
    if (on) root().dataset.sidebar = 'collapsed'; else delete root().dataset.sidebar
    dispatchEvent(new Event('prefs')) // the shell's collapse button follows
  }
  const segmented = (label: string, value: string, options: [string, string][], pick: (v: string) => void) => (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => pick(v)}>{text}</button>)}
    </div>
  )
  return (
    <section id="appearance" className="settings-card" aria-labelledby="appearance-title">
      <header><h2 id="appearance-title">Appearance</h2><p>Saved in this browser, so each device can have its own.</p></header>
      <div className="setting-row">
        <div><strong>Theme</strong><span>System follows your device’s light or dark setting.</span></div>
        {segmented('Theme', theme, [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], chooseTheme)}
      </div>
      <div className="setting-row">
        <div><strong>Text size</strong><span>The size of the text while you write.</span></div>
        {segmented('Text size', size, [['small', 'Small'], ['default', 'Default'], ['large', 'Large']], chooseSize)}
      </div>
      <div className="setting-row">
        <div><strong>Compact sidebar</strong><span>Show only icons in the sidebar on wide screens.</span></div>
        <input type="checkbox" role="switch" className="switch" aria-label="Compact sidebar" checked={compact} onChange={(e) => chooseCompact(e.target.checked)} />
      </div>
    </section>
  )
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { user, settings, hasPassword, github, devices, owned } = loaderData
  const profile = useFetcher()
  const photo = useFetcher()
  const color = useFetcher()
  const password = useFetcher()
  const account = useFetcher()
  const notify = useFetcher()
  const nib = useFetcher()
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [linking, setLinking] = useState(false)
  const passwordForm = useRef<HTMLFormElement>(null)
  useEffect(() => { if ((password.data as Result)?.ok) passwordForm.current?.reset() }, [password.data])

  // The photo goes to the same image store as the editor, then its address is saved on the account.
  const upload = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) return setUploadError('Choose a photo of 2 MB or smaller.')
    setUploading(true); setUploadError('')
    const res = await fetch('/upload', { method: 'POST', body: file, headers: { 'content-type': file.type, 'x-file-name': file.name } })
    setUploading(false)
    if (!res.ok) return setUploadError(await res.text())
    photo.submit({ intent: 'photo', image: (await res.json() as { url: string }).url }, { method: 'post' })
  }
  const pendingColor = color.formData?.get('color')
  const shownColor = pendingColor !== undefined ? colorFor(user.id, String(pendingColor)) : user.color
  const muted = new Set(settings.muted)

  const sections: [string, string][] = [['profile', 'Profile'], ['account', 'Account'], ['appearance', 'Appearance'], ['notifications', 'Notifications'], ['nib', 'Nib'], ['danger', 'Delete account']]
  return (
    <div className="page settings">
      <header className="page-title">
        <p className="eyebrow">Settings</p>
        <h1>Your settings</h1>
        <p className="muted">Changes save as you make them, except the ones with a button.</p>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>
        <div className="settings-sections">
          <section id="profile" className="settings-card" aria-labelledby="profile-title">
            <header><h2 id="profile-title">Profile</h2><p>How other people see you in documents, comments, and activity.</p></header>
            <div className="setting-row">
              <div className="photo-row">
                <Avatar name={user.name} color={shownColor} image={photo.formData ? String(photo.formData.get('image') || '') || null : user.image} size={64} />
                <div><strong>Photo</strong><span>PNG, JPEG, GIF, or WebP, up to 2 MB.</span></div>
              </div>
              <div className="setting-actions">
                <label className="button" aria-busy={uploading}>
                  {uploading ? <span className="spinner" aria-hidden="true" /> : <Icon name="up" />}{user.image ? 'Change photo' : 'Upload photo'}
                  <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" disabled={uploading} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
                </label>
                {user.image && <button type="button" className="ghost" onClick={() => photo.submit({ intent: 'photo', image: '' }, { method: 'post' })}>Remove</button>}
              </div>
              {uploadError && <p className="setting-said" data-error role="alert">{uploadError}</p>}
              <Said fetcher={photo} intent="photo" />
            </div>
            <profile.Form method="post" className="setting-row">
              <input type="hidden" name="intent" value="name" />
              <label htmlFor="name"><strong>Name</strong><span>Shown on your cursor, comments, and tasks.</span></label>
              <div className="setting-actions">
                <input id="name" name="name" defaultValue={user.name} maxLength={60} required autoComplete="name" />
                <button className="primary" disabled={profile.state !== 'idle'} aria-busy={profile.state !== 'idle'}>Save</button>
              </div>
              <Said fetcher={profile} intent="name" />
            </profile.Form>
            <div className="setting-row">
              <div><strong>Avatar color</strong><span>Behind your initials when you have no photo, and on your cursor.</span></div>
              <div className="swatches" role="radiogroup" aria-label="Avatar color">
                <button type="button" role="radio" aria-checked={!settings.color} className="swatch auto" title="Automatic" onClick={() => color.submit({ intent: 'color', color: '' }, { method: 'post' })}><span className="sr-only">Automatic</span>A</button>
                {colors.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={settings.color === c} className="swatch" style={{ background: c }} title={c} onClick={() => color.submit({ intent: 'color', color: c }, { method: 'post' })}>
                    <span className="sr-only">Color {c}</span>{settings.color === c && <Icon name="check" />}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section id="account" className="settings-card" aria-labelledby="account-title">
            <header><h2 id="account-title">Account</h2><p>How you sign in.</p></header>
            <div className="setting-row">
              <div><strong>Email</strong><span>You sign in with it. It cannot be changed yet.</span></div>
              <span className="setting-value">{user.email}</span>
            </div>
            <password.Form method="post" className="setting-row setting-stack" ref={passwordForm}>
              <input type="hidden" name="intent" value="password" />
              <input type="hidden" name="has" value={hasPassword ? '1' : '0'} />
              <div><strong>{hasPassword ? 'Password' : 'Set a password'}</strong><span>{hasPassword ? 'At least 8 characters.' : 'You sign in with GitHub. A password lets you sign in with your email too.'}</span></div>
              <div className="password-fields">
                {hasPassword && <label>Current password<input type="password" name="current" autoComplete="current-password" required /></label>}
                <label>New password<input type="password" name="new" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
                <label>Repeat the new password<input type="password" name="confirm" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
              </div>
              <div className="setting-actions">
                <label className="check"><input type="checkbox" name="others" defaultChecked />Sign out my other devices</label>
                <button className="primary" disabled={password.state !== 'idle'} aria-busy={password.state !== 'idle'}>
                  {password.state !== 'idle' && <span className="spinner" aria-hidden="true" />}{hasPassword ? 'Change password' : 'Set password'}
                </button>
              </div>
              <Said fetcher={password} intent="password" ok="Password changed" />
            </password.Form>
            <div className="setting-row">
              <div><strong>GitHub</strong><span>{github === null ? 'GitHub sign-in is not set up on this server.' : github ? 'Connected. You can sign in with GitHub.' : 'Connect it to sign in with GitHub.'}</span></div>
              {github !== null && (github ? (
                <account.Form method="post"><button name="intent" value="unlink-github" className="ghost" disabled={account.state !== 'idle'}>Disconnect</button></account.Form>
              ) : (
                <button type="button" className="button" disabled={linking} aria-busy={linking} onClick={async () => { setLinking(true); await authClient.linkSocial({ provider: 'github', callbackURL: '/settings#account' }) }}>
                  {linking && <span className="spinner" aria-hidden="true" />}Connect GitHub
                </button>
              ))}
              <Said fetcher={account} intent="unlink-github" ok="Disconnected" />
            </div>
            <div className="setting-row setting-stack">
              <div><strong>Devices</strong><span>Where you are signed in now.</span></div>
              <ul className="devices">
                {devices.map((d) => (
                  <li key={d.id}>
                    <Icon name={/iOS|Android/.test(d.device) ? 'user' : 'docs'} />
                    <span><strong>{d.device}</strong><span>{d.current ? 'Active now' : `Active ${new Date(d.at).toLocaleDateString('en', { month: 'short', day: 'numeric' })}`}</span></span>
                    {d.current && <span className="status" data-status="approved">This device</span>}
                  </li>
                ))}
              </ul>
              <account.Form method="post" className="setting-actions">
                <button name="intent" value="sign-out-others" className="button" disabled={devices.length < 2 || account.state !== 'idle'}>Sign out other devices</button>
              </account.Form>
              <Said fetcher={account} intent="sign-out-others" ok="Signed out everywhere else" />
            </div>
          </section>

          <Appearance />

          <section id="notifications" className="settings-card" aria-labelledby="notifications-title">
            <header><h2 id="notifications-title">Notifications</h2><p>What reaches your bell. Only what other people do is ever shown.</p></header>
            <notify.Form method="post" onChange={(e) => notify.submit(e.currentTarget)}>
              <input type="hidden" name="intent" value="notifications" />
              {(Object.keys(kinds) as Kind[]).map((k) => (
                <label key={k} className="setting-row">
                  <div><strong>{kinds[k].label}</strong><span>{kinds[k].hint}</span></div>
                  <input type="checkbox" role="switch" className="switch" name="kind" value={k} defaultChecked={!muted.has(k)} />
                </label>
              ))}
            </notify.Form>
            <Said fetcher={notify} intent="notifications" />
          </section>

          <section id="nib" className="settings-card" aria-labelledby="nib-title">
            <header><h2 id="nib-title"><span className="ai-mark" aria-hidden="true">✦</span> Nib</h2><p>The writing assistant in your documents.</p></header>
            <nib.Form method="post" onChange={(e) => nib.submit(e.currentTarget)}>
              <input type="hidden" name="intent" value="nib" />
              <label className="setting-row">
                <div><strong>Use Nib</strong><span>Off hides “Ask Nib”, the @nib shortcut, and Nib in the @ list of comments for you.</span></div>
                <input type="checkbox" role="switch" className="switch" name="nib" defaultChecked={settings.nib} />
              </label>
            </nib.Form>
            <p className="setting-note">Nib runs on Cloudflare’s free daily allowance, shared by everyone on this site: a few hundred requests a day. When it runs out, Nib tells you, and it works again the next day.</p>
            <Said fetcher={nib} intent="nib" />
          </section>

          <section id="danger" className="settings-card danger-zone" aria-labelledby="danger-title">
            <header><h2 id="danger-title">Delete account</h2><p>This cannot be undone.</p></header>
            <div className="setting-row">
              <div>
                <strong>Delete your account and your documents</strong>
                <span>{owned.docs === 1 ? '1 document' : `${owned.docs} documents`} and {owned.spaces === 1 ? '1 space' : `${owned.spaces} spaces`} you own are deleted. You leave everything shared with you.</span>
              </div>
              <Confirm title="Delete your account?" confirm="Delete account" busy="Deleting…" fields={{ intent: 'delete-account' }}
                trigger={(open) => <button type="button" className="danger-solid" onClick={open}><Icon name="trash" />Delete account</button>}
                inputs={<label className="confirm-type">Type <strong>{user.email}</strong> to confirm<input name="email" autoComplete="off" required autoFocus /></label>}>
                <ul>
                  <li><strong>{owned.docs === 1 ? '1 document' : `${owned.docs} documents`} you own are deleted</strong>, with their history and comments.</li>
                  <li>{owned.spaces === 1 ? 'Your space is deleted' : `Your ${owned.spaces} spaces are deleted`}; other people’s documents in them stay with their owners.</li>
                  <li>You are signed out everywhere. What you did stays in other people’s activity as “Deleted user”.</li>
                </ul>
              </Confirm>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
