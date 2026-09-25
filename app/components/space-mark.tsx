import { colorFor } from '~/lib/color'

// A space's mark: its logo, or its first letter on its color. Decorative: the name is always next to it.
export function SpaceMark({ space, size = 18 }: { space: { id: string; name: string; logo: string | null; color: string | null }; size?: number }) {
  return (
    <span className="space-mark" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.55, background: space.logo ? undefined : colorFor(space.id, space.color) }}>
      {space.logo ? <img src={space.logo} alt="" /> : space.name.trim()[0]?.toUpperCase() ?? '?'}
    </span>
  )
}
