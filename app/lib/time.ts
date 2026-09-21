const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536e6], ['month', 2592e6], ['week', 6048e5], ['day', 864e5], ['hour', 36e5], ['minute', 6e4]]
const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

// "just now", "5 minutes ago", "yesterday". Built into the browser and the Worker, no library.
export const timeAgo = (ms: number) => {
  const diff = ms - Date.now()
  for (const [unit, size] of units) if (Math.abs(diff) >= size) return format.format(Math.round(diff / size), unit)
  return 'just now'
}
