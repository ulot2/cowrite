// Dark enough that white text on top of them passes the contrast rule (4.5:1).
const colors = ['#c2185b', '#1565c0', '#2e7d32', '#bf360c', '#6a1b9a', '#00695c']

// The same id always gets the same color, in every tab and on every page.
export const colorFor = (id: string) => colors[[...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % colors.length]
