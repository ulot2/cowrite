import { useEffect, useRef, useState } from 'react'
import { useFetcher, type FetcherWithComponents } from 'react-router'
import type { Member, ShareLink, SpaceRow } from '~/lib/access.server'
import type { Role } from '~/lib/roles'
import { timeAgo } from '~/lib/time'
import { Avatar } from './avatar'
import { colorFor } from '~/lib/color'
import { Icon } from './icon'
import { Select } from './select'

const grantable: Role[] = ['viewer', 'commenter', 'reviewer', 'editor']
const describe: Record<Role, string> = { owner: 'Owner', editor: 'Can edit', reviewer: 'Can review', commenter: 'Can comment', viewer: 'Can view' }
const hints: Record<Role, string> = { owner: '', editor: 'Change the text', reviewer: 'Suggest changes', commenter: 'Read and comment', viewer: 'Read only' }
const roleOptions = grantable.map((r) => ({ value: r, label: describe[r], hint: hints[r] }))

type Props = {
  target: 'document' | 'space'
  isOwner: boolean
  members: Member[]
  link: ShareLink | null
  spaces?: SpaceRow[]
  spaceId?: string | null
  published?: { slug: string | null; at: number | null } // documents only: the public page
  className?: string // "tool" on the document page: icon plus label, icon only on phones
}

type Fetcher = FetcherWithComponents<{ error?: string } | null>

// A submit button that knows when its own request is running: a spinner, a busy label, disabled.
function Submit({ fetcher, intent, busy, className, children }: { fetcher: Fetcher; intent: string; busy: string; className?: string; children: React.ReactNode }) {
  const pending = fetcher.state !== 'idle' && fetcher.formData?.get('intent') === intent
  return (
    <button className={className} name="intent" value={intent} disabled={fetcher.state !== 'idle'} aria-busy={pending}>
      {pending ? <><span className="spinner" aria-hidden="true" />{busy}</> : children}
    </button>
  )
}

// A select that saves as soon as it changes, with a small "Saving…" next to it.
function Saving({ fetcher }: { fetcher: Fetcher }) {
  return fetcher.state !== 'idle' ? <span className="saving" role="status"><span className="spinner" aria-hidden="true" />Saving…</span> : null
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600) }
  return <button type="button" onClick={copy} aria-live="polite">{copied ? <><Icon name="check" />Copied</> : 'Copy'}</button>
}

function MemberRow({ m, isOwner }: { m: Member; isOwner: boolean }) {
  const fetcher = useFetcher() as Fetcher
  const removing = fetcher.formData?.get('intent') === 'remove'
  return (
    <li data-leaving={removing || undefined}>
      <Avatar name={m.name} color={colorFor(m.user_id)} size={32} />
      <span className="member-name"><strong>{m.name}</strong><span className="muted">{m.email}</span></span>
      {isOwner && m.role !== 'owner' ? (
        <span className="member-actions">
          {fetcher.state !== 'idle' && !removing && <Saving fetcher={fetcher} />}
          {/* Two forms: one "intent" per request, so the server never reads the wrong one. */}
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="role" /><input type="hidden" name="user_id" value={m.user_id} />
            <Select name="role" options={roleOptions} defaultValue={m.role} label={`Role of ${m.name}`} disabled={fetcher.state !== 'idle'} autoSubmit className="quiet" />
          </fetcher.Form>
          <fetcher.Form method="post">
            <input type="hidden" name="user_id" value={m.user_id} />
            <Submit fetcher={fetcher} intent="remove" busy="" className="ghost icon-only"><Icon name="close" /><span className="sr-only">Remove {m.name}</span></Submit>
          </fetcher.Form>
        </span>
      ) : <span className="member-role muted">{describe[m.role]}</span>}
    </li>
  )
}

// A native <dialog>: the browser handles focus, Escape, and the backdrop. A sheet from the bottom on phones.
export function ShareDialog({ target, isOwner, members, link, spaces, spaceId, published, className }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  // The server renders the path; the browser adds its origin after mount, so both render the same HTML.
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(location.origin), [])

  const add = useFetcher() as Fetcher
  const access = useFetcher() as Fetcher
  const publish = useFetcher() as Fetcher
  const move = useFetcher() as Fetcher
  // After someone is added, empty the field for the next one.
  const addForm = useRef<HTMLFormElement>(null)
  useEffect(() => { if (add.state === 'idle' && add.data === null) addForm.current?.reset() }, [add.state, add.data])

  const linkUrl = link ? `${origin}/s/${link.token}` : ''
  const publicUrl = published?.at && published.slug ? `${origin}/p/${published.slug}` : ''

  return (
    <>
      <button type="button" className={className} title="Share" onClick={() => ref.current?.showModal()}>{className?.startsWith('tool') ? <><Icon name="share" /><span className="tool-label">Share</span></> : 'Share'}</button>
      <dialog ref={ref} className="share" aria-labelledby="share-title" onClick={(e) => { if (e.target === ref.current) ref.current.close() }}>
        <header className="share-head">
          <div>
            <h2 id="share-title">Share this {target}</h2>
            <p className="muted small">{members.length === 1 ? 'Only you have access' : `${members.length} people have access`}</p>
          </div>
          <button className="ghost icon-only" type="button" onClick={() => ref.current?.close()}><Icon name="close" /><span className="sr-only">Close</span></button>
        </header>

        <div className="share-body">
          {isOwner && (
            <section className="share-section">
              <add.Form method="post" className="share-add" ref={addForm}>
                <input type="hidden" name="intent" value="add" />
                <input name="email" type="email" placeholder="Add people by email" aria-label="Email of the person to add" autoComplete="off" required />
                <Select name="role" options={roleOptions} defaultValue="editor" label="Role" />
                <Submit fetcher={add} intent="add" busy="Adding…" className="primary">Add</Submit>
              </add.Form>
              {add.data?.error ? <p className="error small" role="alert">{add.data.error}</p> : <p className="muted small">They need a cowrite account with that email. No email is sent.</p>}
            </section>
          )}

          <ul className="members" aria-label="People with access">
            {members.map((m) => <MemberRow key={m.user_id} m={m} isOwner={isOwner} />)}
          </ul>

          {isOwner && (
            <>
              <section className="share-section">
                <h3><Icon name="link" />Anyone with the link</h3>
                {link ? (
                  <>
                    <div className="share-row">
                      <input readOnly value={linkUrl} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
                      <CopyButton text={linkUrl} />
                    </div>
                    <div className="share-foot">
                      <span className="muted small">{describe[link.role]} · make a new link to change the role</span>
                      <access.Form method="post"><Submit fetcher={access} intent="link-revoke" busy="Turning off…" className="ghost danger">Turn off</Submit></access.Form>
                    </div>
                  </>
                ) : (
                  <access.Form method="post" className="share-row">
                    <Select name="role" options={roleOptions} defaultValue="viewer" label="Role for the link" />
                    <Submit fetcher={access} intent="link-create" busy="Creating…">Create link</Submit>
                  </access.Form>
                )}
              </section>

              {published && (
                <section className="share-section">
                  <h3><Icon name="globe" />Publish to the web{publicUrl && <span className="live-dot">Live</span>}</h3>
                  {publicUrl ? (
                    <>
                      <div className="share-row">
                        <input readOnly value={publicUrl} aria-label="Public page" onFocus={(e) => e.currentTarget.select()} />
                        <CopyButton text={publicUrl} />
                        <a className="button icon-only" href={publicUrl} target="_blank" rel="noopener"><Icon name="open" /><span className="sr-only">Open the public page</span></a>
                      </div>
                      <publish.Form method="post" className="share-foot">
                        <span className="muted small">Updated {timeAgo(published.at!)}. Later edits stay private until you update.</span>
                        <span className="share-actions">
                          <Submit fetcher={publish} intent="unpublish" busy="Unpublishing…" className="ghost danger">Unpublish</Submit>
                          <Submit fetcher={publish} intent="publish" busy="Updating…">Update</Submit>
                        </span>
                      </publish.Form>
                    </>
                  ) : (
                    <publish.Form method="post" className="share-foot">
                      <span className="muted small">A public, read-only page of the current text. No account needed to read it.</span>
                      <Submit fetcher={publish} intent="publish" busy="Publishing…" className="primary">Publish</Submit>
                    </publish.Form>
                  )}
                </section>
              )}

              {spaces && (
                <section className="share-section">
                  <h3><Icon name="space" />Space</h3>
                  <move.Form method="post" className="share-row">
                    <input type="hidden" name="intent" value="move" />
                    <Select name="space_id" options={[{ value: '', label: 'No space' }, ...spaces.map((s) => ({ value: s.id, label: s.name }))]} defaultValue={spaceId ?? ''} label="Space" disabled={move.state !== 'idle'} autoSubmit />
                    <Saving fetcher={move} />
                  </move.Form>
                  <p className="muted small">Members of the space get their space role on this document.</p>
                </section>
              )}
            </>
          )}
        </div>
      </dialog>
    </>
  )
}
