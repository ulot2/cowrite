// Initials in a colored circle. The name is in the title for mouse users and in sr-only text for the rest.
// A photo, when the person uploaded one, covers the circle.
export function Avatar({ name, color, image, size = 28 }: { name: string; color: string; image?: string | null; size?: number }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'
  return (
    <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.4 }} title={name}>
      {image ? <img src={image} alt="" loading="lazy" /> : <span aria-hidden="true">{initials}</span>}
      <span className="sr-only">{name}</span>
    </span>
  )
}
