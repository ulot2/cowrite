import type { Role } from './roles'

export type Status = 'draft' | 'review' | 'approved'
export const statusLabel: Record<Status, string> = { draft: 'Draft', review: 'In review', approved: 'Approved' }

// Every move a document can make, who may make it, and how the timeline says it.
export const moves = {
  submit: { from: 'draft', to: 'review', need: 'editor', label: 'Submit for review', text: 'submitted for review' },
  changes: { from: 'review', to: 'draft', need: 'reviewer', label: 'Request changes', text: 'asked for changes' },
  approve: { from: 'review', to: 'approved', need: 'reviewer', label: 'Approve', text: 'approved' },
  reopen: { from: 'approved', to: 'draft', need: 'editor', label: 'Reopen', text: 'reopened' },
} satisfies Record<string, { from: Status; to: Status; need: Role; label: string; text: string }>
export type Move = keyof typeof moves
