import { useId, useRef, useState } from 'react'
import { Icon } from './icon'

export type Option = { value: string; label: string; hint?: string }

type Props = {
  name: string
  options: Option[]
  defaultValue?: string
  label: string // the accessible name; there is no visible label
  disabled?: boolean
  autoSubmit?: boolean // submit the surrounding form as soon as the value changes
  className?: string
}

// A dropdown that looks like the rest of the app. The value lives in a hidden input, so it works
// in any form. The list is a popover in the browser's top layer: never clipped by a dialog or a
// scrolling box, and light-dismiss and Escape come free. Keyboard: arrows, Home/End, Enter or
// Space to choose, a letter to jump, Escape or Tab to close.
export function Select({ name, options, defaultValue, label, disabled, autoSubmit, className }: Props) {
  const id = useId()
  const [value, setValue] = useState(defaultValue ?? options[0]?.value ?? '')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const current = options.find((o) => o.value === value) ?? options[0]

  const show = () => {
    const b = button.current!.getBoundingClientRect(), l = list.current!
    const below = innerHeight - b.bottom
    l.style.minWidth = `${b.width}px`
    l.style.left = `${Math.min(b.left, innerWidth - 16 - Math.max(b.width, 180))}px`
    // Open upward when there is not enough room below.
    if (below < 240 && b.top > below) { l.style.top = ''; l.style.bottom = `${innerHeight - b.top + 4}px` }
    else { l.style.bottom = ''; l.style.top = `${b.bottom + 4}px` }
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    l.showPopover()
    l.focus()
  }
  const hide = () => { if (list.current?.matches(':popover-open')) list.current.hidePopover(); button.current?.focus() }
  const choose = (v: string) => {
    hide()
    if (v === value) return
    setValue(v)
    input.current!.value = v
    if (autoSubmit) input.current!.form?.requestSubmit()
  }

  const onListKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1
    const move = (i: number) => { e.preventDefault(); setActive(i); list.current?.children[i]?.scrollIntoView({ block: 'nearest' }) }
    if (e.key === 'ArrowDown') move(Math.min(active + 1, last))
    else if (e.key === 'ArrowUp') move(Math.max(active - 1, 0))
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(last)
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(options[active].value) }
    else if (e.key === 'Tab') hide()
    else if (e.key.length === 1) {
      const i = options.findIndex((o, n) => n > active && o.label.toLowerCase().startsWith(e.key.toLowerCase()))
      const j = i >= 0 ? i : options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()))
      if (j >= 0) move(j)
    }
  }

  return (
    <span className={`select ${className ?? ''}`}>
      <input type="hidden" name={name} defaultValue={value} ref={input} />
      <button ref={button} type="button" className="select-button" disabled={disabled} aria-label={`${label}: ${current?.label}`}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={id}
        onClick={() => (open ? hide() : show())}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show() } }}>
        <span className="select-value">{current?.label}</span>
        <Icon name="chevron" />
      </button>
      <ul ref={list} id={id} popover="auto" role="listbox" tabIndex={-1} className="select-list" aria-label={label}
        aria-activedescendant={`${id}-${active}`} onKeyDown={onListKey}
        onToggle={(e) => setOpen((e as unknown as ToggleEvent).newState === 'open')}>
        {options.map((o, i) => (
          <li key={o.value} id={`${id}-${i}`} role="option" aria-selected={o.value === value} data-active={i === active || undefined}
            onPointerMove={() => setActive(i)} onClick={() => choose(o.value)}>
            <span>{o.label}{o.hint && <small>{o.hint}</small>}</span>
            {o.value === value && <Icon name="check" />}
          </li>
        ))}
      </ul>
    </span>
  )
}
