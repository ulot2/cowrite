import { useEffect, useId, useRef, useState } from 'react'
import { kindLabel, workKey, type WorkNode } from '~/lib/connections'
import { Icon } from './icon'

const icons = { idea: 'board', discussion: 'comment', decision: 'check', document: 'docs', task: 'tasks' } as const
const statusLabel = (status: string) => status === 'review' ? 'In review' : status.charAt(0).toUpperCase() + status.slice(1)
const metadata = (item: WorkNode) => item.status === item.kind ? kindLabel[item.kind] : `${kindLabel[item.kind]} · ${statusLabel(item.status)}`
const positionPopover = (button: HTMLButtonElement, panel: HTMLDivElement) => {
  const bounds = button.getBoundingClientRect()
  const width = Math.min(Math.max(bounds.width, 360), innerWidth - 24)
  const below = innerHeight - bounds.bottom, above = bounds.top
  const upward = below < 300 && above > below
  panel.style.width = `${width}px`
  panel.style.left = `${Math.max(12, Math.min(bounds.left, innerWidth - width - 12))}px`
  panel.style.maxHeight = `${Math.min(380, Math.max(0, (upward ? above : below) - 12))}px`
  panel.style.top = upward ? '' : `${bounds.bottom + 6}px`
  panel.style.bottom = upward ? `${innerHeight - bounds.top + 6}px` : ''
}

// A focused search-and-pick control for work. The top-layer popover stays clear
// of task rows, boards, and scrolling panels; selection keeps the form inline.
export function WorkPicker({ items, value, onChange, disabled }: { items: WorkNode[]; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const current = items.find((item) => workKey(item) === value)
  const matches = items.filter((item) => `${kindLabel[item.kind]} ${item.label}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const activeIndex = Math.min(active, matches.length - 1)
  const close = (restoreFocus = true) => {
    if (popover.current?.matches(':popover-open')) popover.current.hidePopover()
    if (restoreFocus) trigger.current?.focus()
  }
  const show = () => {
    const button = trigger.current!, panel = popover.current!
    positionPopover(button, panel)
    setQuery(''); setActive(Math.max(0, items.findIndex((item) => workKey(item) === value)))
    panel.showPopover(); search.current?.focus({ preventScroll: true })
  }
  const choose = (item: WorkNode) => { onChange(workKey(item)); close() }
  useEffect(() => {
    if (!open || activeIndex < 0 || !list.current) return
    const row = list.current.children[activeIndex]?.getBoundingClientRect(), bounds = list.current.getBoundingClientRect()
    if (row && row.top < bounds.top) list.current.scrollTop += row.top - bounds.top
    else if (row && row.bottom > bounds.bottom) list.current.scrollTop += row.bottom - bounds.bottom
  }, [open, activeIndex, query])
  useEffect(() => {
    if (!open) return
    const reposition = (event: Event) => {
      if (event.target instanceof Node && popover.current?.contains(event.target)) return
      if (trigger.current && popover.current?.matches(':popover-open')) positionPopover(trigger.current, popover.current)
    }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => { window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true) }
  }, [open])

  return <div className="work-picker">
    <input type="hidden" name="target" value={current ? value : ''} />
    <button ref={trigger} type="button" className="work-picker-trigger" disabled={disabled}
      aria-label={`Work item: ${current?.label ?? 'Choose work to connect'}`} aria-haspopup="dialog" aria-controls={`${id}-popover`} aria-expanded={open}
      onClick={() => open ? close() : show()} onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show() }
      }}>
      <Icon name={current ? icons[current.kind] : 'search'} />
      <span className="work-picker-value">{current ? <><strong>{current.label}</strong><small>{metadata(current)}</small></> : <span className="muted">Choose work to connect…</span>}</span>
      <Icon name="chevron" />
    </button>
    <div ref={popover} id={`${id}-popover`} popover="auto" role="dialog" aria-label="Choose work" className="work-picker-popover"
      onToggle={(event) => setOpen((event as unknown as ToggleEvent).newState === 'open')}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(false) }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
      <div className="work-picker-search"><Icon name="search" /><input ref={search} role="combobox" aria-label="Find work" aria-expanded={open} aria-autocomplete="list" aria-controls={`${id}-list`}
        aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined} placeholder="Search by title or kind…" value={query}
        onChange={(event) => { setQuery(event.target.value); setActive(0) }} onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setActive(Math.max(0, Math.min(matches.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1))))
          } else if (event.key === 'Enter') { event.preventDefault(); if (matches[activeIndex]) choose(matches[activeIndex]) }
        }} /></div>
      <p className="work-picker-caption">{query.trim() ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}` : 'Available work'}</p>
      <ul ref={list} id={`${id}-list`} role="listbox" aria-label="Available work" className="work-picker-list">
        {matches.map((item, index) => <li key={workKey(item)} id={`${id}-option-${index}`} role="option" aria-selected={workKey(item) === value}
          data-active={activeIndex === index || undefined} onPointerMove={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>
          <Icon name={icons[item.kind]} /><span><strong>{item.label}</strong><small>{metadata(item)}</small></span>{workKey(item) === value && <Icon name="check" />}
        </li>)}
      </ul>
      {matches.length === 0 && <p className="work-picker-empty" role="status">{items.length ? <>No work matches “{query}”.<small>Try another title or search for a kind of work.</small></> : <>No available work yet.<small>Create an idea, discussion, document, or task first.</small></>}</p>}
    </div>
  </div>
}
