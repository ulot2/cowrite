import { useEffect, useState } from 'react'

// Light or dark, for pages without Settings (guest documents). Saved in the browser under `theme`,
// the key root.tsx reads before the first paint and Settings writes.
export function ThemeToggle({ className = 'tool' }: { className?: string }) {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const t = document.documentElement.dataset.theme
    setDark(t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches)
  }, [])
  const flip = () => {
    const next = dark ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('theme', next) } catch { /* private window: this page only */ }
    setDark(!dark)
  }
  return (
    <button type="button" className={className} onClick={flip} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} data-tip={dark ? 'Light mode' : 'Dark mode'}>
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {dark
          ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
          : <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />}
      </svg>
    </button>
  )
}
