export const workKinds = ['idea', 'discussion', 'decision', 'document', 'task'] as const
export type WorkKind = typeof workKinds[number]
export type WorkRef = { kind: WorkKind; id: string }
export type WorkNode = WorkRef & { label: string; href: string; status: string }
export type ConnectedItem = WorkNode & { depth: number; reason: string; linkId?: string }
export type Connections = { anchor: WorkNode; canManage: boolean; items: ConnectedItem[]; candidates: WorkNode[]; truncated: boolean; error?: string; message?: string }
export type ConnectionsResult = Connections | { error: string }

export const workKey = (ref: WorkRef) => `${ref.kind}:${ref.id}`
export const ideaRef = (room: string, id: string): WorkRef => ({ kind: 'idea', id: `${room}:${id}` })
export const kindLabel: Record<WorkKind, string> = { idea: 'Idea', discussion: 'Discussion', decision: 'Decision', document: 'Document', task: 'Task' }
export const parseWorkRef = (kind: unknown, id: unknown): WorkRef | null =>
  typeof kind === 'string' && workKinds.includes(kind as WorkKind) && typeof id === 'string' && id.length > 0 && id.length <= 500 && !/[\u0000-\u001f]/.test(id)
    ? { kind: kind as WorkKind, id } : null
