import { useEffect, useId, useRef, useState } from 'react'
import { useFetcher, useLocation } from 'react-router'
import type { CreateSpaceError } from '~/lib/create-space.server'
import { Icon } from './icon'

export function CreateSpaceForm({ onCancel, action = '/?index', heading = 'dialog' }: { onCancel?: () => void; action?: string; heading?: 'dialog' | 'page' }) {
  const id = useId()
  const fetcher = useFetcher<CreateSpaceError>()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const pending = fetcher.state !== 'idle'
  const error = fetcher.data
  const Heading = heading === 'page' ? 'h1' : 'h2'
  return (
    <fetcher.Form method="post" action={action} className="create-space-form" aria-busy={pending}>
      <input type="hidden" name="intent" value="new-space" />
      <header>
        <Heading id="create-space-title">Create a space</Heading>
        <p id="create-space-description">Bring a project’s ideas, discussions, and documents together.</p>
      </header>
      <label htmlFor={`${id}-name`}>Space name
        <input id={`${id}-name`} name="name" placeholder="e.g. Website redesign" required maxLength={60} autoComplete="off" autoFocus
          value={name} onChange={(e) => setName(e.target.value)} readOnly={pending}
          aria-invalid={error?.field === 'name' || undefined} aria-describedby={error?.field === 'name' ? `${id}-error` : undefined} />
      </label>
      <label htmlFor={`${id}-description`}><span>Description <span className="field-optional">Optional</span></span>
        <input id={`${id}-description`} name="description" placeholder="What are you working toward?" maxLength={140}
          value={description} onChange={(e) => setDescription(e.target.value)} readOnly={pending}
          aria-invalid={error?.field === 'description' || undefined} aria-describedby={error?.field === 'description' ? `${id}-error` : undefined} />
      </label>
      <p className="space-privacy"><Icon name="lock" />Only members can open this space.</p>
      {error?.error && <p id={`${id}-error`} className="error" role="alert">{error.error}</p>}
      <footer>
        {onCancel && <button type="button" onClick={onCancel} disabled={pending}>Cancel</button>}
        <button className="primary" disabled={pending} aria-busy={pending}>{pending ? <><span className="spinner" aria-hidden="true" />Creating…</> : 'Create space'}</button>
      </footer>
    </fetcher.Form>
  )
}

export function CreateSpaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const location = useLocation()
  // A successful redirect closes the form; a server error leaves the draft in place.
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => { close.current() }, [location.key])
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal()
    else if (!open && ref.current?.open) ref.current.close()
  }, [open])
  return (
    <dialog ref={ref} className="create-space-dialog" aria-labelledby="create-space-title" aria-describedby="create-space-description"
      onClose={onClose} onClick={(e) => { if (e.target === ref.current && !ref.current.querySelector('[aria-busy="true"]')) onClose() }}
      onCancel={(e) => { if (ref.current?.querySelector('[aria-busy="true"]')) e.preventDefault(); else onClose() }}>
      {open && <CreateSpaceForm onCancel={onClose} />}
    </dialog>
  )
}
