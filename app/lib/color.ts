// Dark enough that white text on top of them passes the contrast rule (4.5:1).
export const colors = ['#c2185b', '#1565c0', '#2e7d32', '#bf360c', '#6a1b9a', '#00695c', '#37474f', '#4527a0']

// A person's chosen color, or the one their id always gets, in every tab and on every page.
export const colorFor = (id: string, chosen?: string | null) =>
  chosen && colors.includes(chosen) ? chosen : colors[[...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 6]
