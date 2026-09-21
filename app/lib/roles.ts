// The role ladder. Shared by the server (checks) and the pages (what to show).
export type Role = 'owner' | 'editor' | 'reviewer' | 'commenter' | 'viewer'
export const roles: Role[] = ['viewer', 'commenter', 'reviewer', 'editor', 'owner']
export const rank = (r: Role | null | undefined) => (r ? roles.indexOf(r) : -1)

// True when `role` is at least `needed` on the ladder viewer < commenter < reviewer < editor < owner.
export const atLeast = (role: Role | null | undefined, needed: Role) => rank(role) >= rank(needed)
