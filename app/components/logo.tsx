// The mark: two overlapping rings, two people on one document. Drawn once, reused everywhere.
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <circle cx="12.5" cy="16" r="6" fill="none" stroke="var(--accent-fg)" strokeWidth="2.6" />
      <circle cx="19.5" cy="16" r="6" fill="none" stroke="var(--accent-fg)" strokeWidth="2.6" />
    </svg>
  )
}
