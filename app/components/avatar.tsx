// Initials in a colored circle. The name is in the title for mouse users and in sr-only text for the rest.
export function Avatar({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'
  return (
    <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.4 }} title={name}>
      <span aria-hidden="true">{initials}</span>
      <span className="sr-only">{name}</span>
    </span>
  )
}
