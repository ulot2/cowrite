import type { Role } from './roles'

export type Status = 'idea' | 'draft' | 'review' | 'approved' | 'done'
export const statusLabel: Record<Status, string> = { idea: 'Idea', draft: 'Draft', review: 'In review', approved: 'Approved', done: 'Done' }

// Every move a document can make, from which states, who may make it, and how the timeline says it.
export const moves = {
  start: { from: ['idea'], to: 'draft', need: 'editor', label: 'Start drafting', text: 'started drafting' },
  submit: { from: ['draft'], to: 'review', need: 'editor', label: 'Submit for review', text: 'submitted for review' },
  changes: { from: ['review'], to: 'draft', need: 'reviewer', label: 'Request changes', text: 'asked for changes' },
  approve: { from: ['review'], to: 'approved', need: 'reviewer', label: 'Approve', text: 'approved' },
  finish: { from: ['approved'], to: 'done', need: 'editor', label: 'Mark done', text: 'marked it done' },
  reopen: { from: ['approved', 'done'], to: 'draft', need: 'editor', label: 'Reopen', text: 'reopened' },
} satisfies Record<string, { from: Status[]; to: Status; need: Role; label: string; text: string }>
export type Move = keyof typeof moves
export const canMove = (m: Move, status: Status) => (moves[m].from as Status[]).includes(status)
