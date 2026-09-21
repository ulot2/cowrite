import { useEffect, useRef, useState } from 'react'
import { Form } from 'react-router'
import type { Member, ShareLink, SpaceRow } from '~/lib/access.server'
import type { Role } from '~/lib/roles'
import { Avatar } from './avatar'
import { colorFor } from '~/lib/color'
import { Icon } from './icon'

const grantable: Role[] = ['viewer', 'commenter', 'reviewer', 'editor']
const describe: Record<Role, string> = { owner: 'Owner', editor: 'Can edit', reviewer: 'Can review', commenter: 'Can comment', viewer: 'Can view' }

type Props = {
  target: 'document' | 'space'
  isOwner: boolean
  members: Member[]
  link: ShareLink | null
  spaces?: SpaceRow[]
  spaceId?: string | null
  error?: string | null
  className?: string // "tool" on the document page: icon plus label, icon only on phones
}

// A native <dialog>: the browser handles focus, Escape, and the backdrop.
export function ShareDialog({ target, isOwner, members, link, spaces, spaceId, error, className }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [copied, setCopied] = useState(false)
  // The server renders the path; the browser adds its origin after mount, so both render the same HTML.
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(location.origin), [])
  const linkUrl = link ? `${origin}/s/${link.token}` : ''
  const copy = async () => { await navigator.clipboard.writeText(linkUrl); setCopied(true); setTimeout(() => setCopied(false), 1500) }

  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.showModal()}>{className === 'tool' ? <><Icon name="share" /><span className="tool-label">Share</span></> : 'Share'}</button>
      <dialog ref={ref} className="share" aria-labelledby="share-title">
        <div className="share-head"><h2 id="share-title">Share this {target}</h2><button className="ghost" type="button" onClick={() => ref.current?.close()} aria-label="Close">✕</button></div>
        {error && <p className="error" role="alert">{error}</p>}

        <ul className="members">
          {members.map((m) => (
            <li key={m.user_id}>
              <Avatar name={m.name} color={colorFor(m.user_id)} size={28} />
              <span className="member-name"><strong>{m.name}</strong><span className="muted">{m.email}</span></span>
              {isOwner && m.role !== 'owner' ? (
                <Form method="post" className="member-actions" onChange={(e) => e.currentTarget.requestSubmit()}>
                  <input type="hidden" name="intent" value="role" /><input type="hidden" name="user_id" value={m.user_id} />
                  <select name="role" defaultValue={m.role} aria-label={`Role of ${m.name}`}>{grantable.map((r) => <option key={r} value={r}>{describe[r]}</option>)}</select>
                  <button className="ghost" name="intent" value="remove" aria-label={`Remove ${m.name}`}>Remove</button>
                </Form>
              ) : <span className="muted">{describe[m.role]}</span>}
            </li>
          ))}
        </ul>

        {isOwner && (
          <>
            <Form method="post" className="share-row">
              <input type="hidden" name="intent" value="add" />
              <input name="email" type="email" placeholder="name@company.com" aria-label="Email of the person to add" required />
              <select name="role" defaultValue="editor" aria-label="Role">{grantable.map((r) => <option key={r} value={r}>{describe[r]}</option>)}</select>
              <button className="primary">Add</button>
            </Form>
            <p className="muted small">The person needs a cowrite account with that email. No email is sent.</p>

            <h3>Anyone with the link</h3>
            {link ? (
              <div className="share-row">
                <input readOnly value={linkUrl} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
                <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
                <Form method="post"><button className="ghost" name="intent" value="link-revoke">Revoke</button></Form>
              </div>
            ) : (
              <Form method="post" className="share-row">
                <input type="hidden" name="intent" value="link-create" />
                <select name="role" defaultValue="viewer" aria-label="Role for the link">{grantable.map((r) => <option key={r} value={r}>{describe[r]}</option>)}</select>
                <button>Create link</button>
              </Form>
            )}
            {link && <p className="muted small">{describe[link.role]}. Create a new link to change the role.</p>}

            {spaces && (
              <>
                <h3>Space</h3>
                <Form method="post" className="share-row" onChange={(e) => e.currentTarget.requestSubmit()}>
                  <input type="hidden" name="intent" value="move" />
                  <select name="space_id" defaultValue={spaceId ?? ''} aria-label="Space">
                    <option value="">No space</option>
                    {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Form>
                <p className="muted small">Members of the space get their space role on this document.</p>
              </>
            )}
          </>
        )}
      </dialog>
    </>
  )
}
