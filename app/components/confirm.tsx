import { useEffect, useRef } from 'react'
import { useFetcher } from 'react-router'
import { Icon } from './icon'

type Props = {
  trigger: (open: () => void) => React.ReactNode // the button that opens the dialog
  title: string
  children: React.ReactNode // what will happen, in plain words
  confirm: string // the action, e.g. "Delete space"
  busy: string // while it runs, e.g. "Deleting…"
  fields: Record<string, string> // what the form posts (intent and ids)
  action?: string
  tone?: 'danger' | 'primary'
}

// A confirm step in the app's own style: a native <dialog> (focus, Escape, and the backdrop come
// free), the consequence in plain words, and the action button showing its own progress.
export function Confirm({ trigger, title, children, confirm, busy, fields, action, tone = 'danger' }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const fetcher = useFetcher()
  const pending = fetcher.state !== 'idle'
  // Close when the request is done (a redirect moves away by itself).
  const was = useRef(false)
  useEffect(() => { if (was.current && !pending) ref.current?.close(); was.current = pending }, [pending])

  return (
    <>
      {trigger(() => ref.current?.showModal())}
      <dialog ref={ref} className="confirm" data-tone={tone} aria-labelledby={`${fields.intent}-title`}
        onClick={(e) => { if (e.target === ref.current && !pending) ref.current.close() }}
        onCancel={(e) => { if (pending) e.preventDefault() }}>
        <div className="confirm-icon" aria-hidden="true"><Icon name={tone === 'danger' ? 'trash' : 'history'} /></div>
        <h2 id={`${fields.intent}-title`}>{title}</h2>
        <div className="confirm-body">{children}</div>
        <fetcher.Form method="post" action={action} className="confirm-actions">
          {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <button type="button" onClick={() => ref.current?.close()} disabled={pending} autoFocus>Cancel</button>
          <button className={tone === 'danger' ? 'danger-solid' : 'primary'} disabled={pending} aria-busy={pending}>
            {pending ? <><span className="spinner" aria-hidden="true" />{busy}</> : confirm}
          </button>
        </fetcher.Form>
      </dialog>
    </>
  )
}
