export const spaceSections = [
  ['overview', 'Overview', 'home'],
  ['ideas', 'Ideas', 'board'],
  ['discussions', 'Discussions', 'comment'],
  ['documents', 'Documents', 'docs'],
  ['decisions', 'Decisions', 'check'],
  ['tasks', 'Tasks', 'tasks'],
] as const

export function spaceTab(value: string | null) {
  return spaceSections.find(([tab]) => tab === value)?.[0] ?? 'overview'
}
