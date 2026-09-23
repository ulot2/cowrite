// What can reach the bell, grouped the way people think about it. Each kind is a set of event types.
export const kinds = {
  edits: { label: 'Edits and changes', hint: 'Someone edits, renames, creates, moves, restores, or deletes a document', types: ['edited', 'renamed', 'created', 'moved', 'deleted', 'version', 'restored'] },
  comments: { label: 'Comments and discussions', hint: 'Someone comments in a document, or starts, answers, or replies to a discussion', types: ['commented', 'discussion'] },
  mentions: { label: 'Mentions', hint: 'Someone mentions a person in a comment', types: ['mention'] },
  tasks: { label: 'Tasks', hint: 'Someone assigns a task', types: ['task'] },
  review: { label: 'Review, suggestions, and decisions', hint: 'Status changes, suggestions accepted or rejected, and decisions made or replaced', types: ['status', 'suggestion', 'decision'] },
  sharing: { label: 'Sharing', hint: 'Someone shares, publishes, or joins', types: ['shared', 'joined', 'published', 'space'] },
} as const
export type Kind = keyof typeof kinds
export const isKind = (k: string): k is Kind => Object.hasOwn(kinds, k)
