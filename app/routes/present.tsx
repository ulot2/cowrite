import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { requireReadable } from '~/lib/guest.server'
import { docStub } from '~/lib/versions.server'
import { toSlides } from '~/lib/rich'
import { Blocks } from '~/components/read-view'
import type { Route } from './+types/present'

export const meta = ({ loaderData }: Route.MetaArgs) => [{ title: `${loaderData?.title ?? 'Slides'} · Present` }]

export async function loader({ request, params }: Route.LoaderArgs) {
  const { title, back } = await requireReadable(request, params.id)
  return { title, back, slides: toSlides((await docStub(params.id).readRich('now')) ?? []) }
}

// Slides from the document. Arrows, Space, Page Up/Down move; F is full screen; N shows the notes;
// Escape goes back to the document.
export default function Present({ loaderData, params }: Route.ComponentProps) {
  const { title, slides } = loaderData
  const [at, setAt] = useState(0)
  const [notes, setNotes] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLAnchorElement>(null)
  const last = Math.max(slides.length - 1, 0)
  const full = () => (document.fullscreenElement ? document.exitFullscreen() : stage.current?.requestFullscreen())

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('button, a') && (e.key === ' ' || e.key === 'Enter')) return
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); setAt((n) => Math.min(n + 1, last)) }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); setAt((n) => Math.max(n - 1, 0)) }
      else if (e.key === 'Home') setAt(0)
      else if (e.key === 'End') setAt(last)
      else if (e.key.toLowerCase() === 'f') full()
      else if (e.key.toLowerCase() === 'n') setNotes((v) => !v)
      else if (e.key === 'Escape' && !document.fullscreenElement) back.current?.click()
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  })

  const slide = slides[at]
  return (
    <div className="present" ref={stage}>
      <div className="present-bar">
        <Link ref={back} to={loaderData.back} className="tool">Back to the document</Link>
        <span className="muted">{title}</span>
        <span className="present-actions">
          <button type="button" className="tool" aria-pressed={notes} onClick={() => setNotes(!notes)}>Notes</button>
          <button type="button" className="tool" onClick={full}>Full screen</button>
        </span>
      </div>
      {slide ? (
        <section className="slide read-view" key={at} aria-roledescription="slide" aria-label={`Slide ${at + 1} of ${slides.length}`}>
          <Blocks blocks={slide.blocks} />
        </section>
      ) : <section className="slide"><p className="muted">This document is empty.</p></section>}
      {notes && <aside className="slide-notes" aria-label="Speaker notes">{slide?.notes.length ? slide.notes.map((n, i) => <p key={i}>{n}</p>) : <p className="muted">No notes. A paragraph that starts with "Note:" becomes a note.</p>}</aside>}
      <div className="present-nav">
        <button type="button" className="tool" onClick={() => setAt(Math.max(at - 1, 0))} disabled={at === 0} aria-label="Previous slide">←</button>
        <span role="status">{slides.length ? at + 1 : 0} / {slides.length}</span>
        <button type="button" className="tool" onClick={() => setAt(Math.min(at + 1, last))} disabled={at === last} aria-label="Next slide">→</button>
      </div>
    </div>
  )
}
