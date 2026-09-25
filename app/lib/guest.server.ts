import { env } from 'cloudflare:workers'
import { requireDocument } from './access.server'
import { indexTitle } from './search.server'
import { docStub } from './versions.server'

// Documents without an account. A guest is a browser with a random id in the HttpOnly `guest`
// cookie; the cookie is the only key. A guest document is a normal document room plus a row in
// `guest_documents`. On sign-up or sign-in the rows move to `documents`, with the same ids.
export const GUEST_DAYS = 30 // a guest document goes this long after its last edit (the room's alarm)
export const MAX_GUEST_DOCS = 10
const NEW_GUESTS_PER_IP = 20 // a day

export type GuestDocument = { id: string; title: string; preview: string; updated_at: number }

export const guestId = (request: Request) => request.headers.get('cookie')?.match(/(?:^|;\s*)guest=([\w-]+)/)?.[1] ?? null
const secure = (request: Request) => (new URL(request.url).protocol === 'https:' ? '; Secure' : '')
export const guestCookie = (id: string, request: Request) => `guest=${id}; Path=/; Max-Age=${GUEST_DAYS * 86400}; HttpOnly; SameSite=Lax${secure(request)}`
export const clearGuestCookie = (request: Request) => `guest=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure(request)}`

// A one-way code for the visitor's IP address, new every day. Limits count it; the address is never stored.
const today = () => new Date().toISOString().slice(0, 10)
export const visitorCode = async (request: Request) => {
  const ip = request.headers.get('cf-connecting-ip') ?? 'local'
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.BETTER_AUTH_SECRET}:${today()}:${ip}`))
  return [...new Uint8Array(hash).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const listGuestDocuments = async (guest: string) =>
  (await env.DB.prepare('SELECT id, title, preview, updated_at FROM guest_documents WHERE guest_id = ? ORDER BY updated_at DESC').bind(guest).all<GuestDocument>()).results

export const getGuestDocument = (id: string, guest: string | null) =>
  guest ? env.DB.prepare('SELECT id, title, preview, updated_at FROM guest_documents WHERE id = ? AND guest_id = ?').bind(id, guest).first<GuestDocument>() : Promise.resolve(null)

export class GuestLimit extends Error {}

// A new document for this browser; a new guest too, when it has none. `seed` fills the first one
// with the short tour. Returns the id and the cookie to set (renewed on every create).
export const createGuestDocument = async (request: Request, seed: boolean) => {
  let guest = guestId(request)
  if (guest) {
    const { n } = (await env.DB.prepare('SELECT COUNT(*) AS n FROM guest_documents WHERE guest_id = ?').bind(guest).first<{ n: number }>())!
    if (n >= MAX_GUEST_DOCS) throw new GuestLimit(`You have ${MAX_GUEST_DOCS} documents, the most without an account. Sign up to make more, or delete one.`)
  } else {
    const key = `guest:${await visitorCode(request)}`
    const row = await env.DB.prepare('INSERT INTO daily_counts (day, key, n) VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET n = n + 1 RETURNING n').bind(today(), key).first<{ n: number }>()
    if ((row?.n ?? 0) > NEW_GUESTS_PER_IP) throw new GuestLimit('Too many new visitors from this network today. Sign up, or try again tomorrow.')
    await env.DB.prepare('DELETE FROM daily_counts WHERE day < ?').bind(today()).run()
    guest = crypto.randomUUID()
  }
  const id = crypto.randomUUID()
  const now = Date.now()
  const title = seed ? 'Try CoWrite' : 'Untitled'
  await env.DB.prepare('INSERT INTO guest_documents (id, guest_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(id, guest, title, now, now).run()
  const room = docStub(id)
  await room.markGuest()
  if (seed) await room.seed('play')
  return { id, cookie: guestCookie(guest, request) }
}

export const renameGuestDocument = (id: string, guest: string, title: string) =>
  env.DB.prepare('UPDATE guest_documents SET title = ?, updated_at = ? WHERE id = ? AND guest_id = ?').bind(title, Date.now(), id, guest).run()

export const deleteGuestDocument = async (id: string, guest: string) => {
  const gone = await env.DB.prepare('DELETE FROM guest_documents WHERE id = ? AND guest_id = ?').bind(id, guest).run()
  if (gone.meta.changes) await docStub(id).wipe()
}

// Sign-up or sign-in with a guest cookie: every guest document becomes the account's own, in one
// batch per document. The rooms keep their ids, so the text does not move. Returns how many moved.
export const claimGuestDocuments = async (request: Request, userId: string) => {
  const guest = guestId(request)
  if (!guest) return 0
  const rows = (await env.DB.prepare('SELECT id, title, preview, created_at, updated_at FROM guest_documents WHERE guest_id = ?').bind(guest).all<GuestDocument & { created_at: number }>()).results
  for (const d of rows) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO documents (id, title, owner_id, preview, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(d.id, d.title, userId, d.preview, d.created_at, d.updated_at),
      env.DB.prepare('INSERT INTO memberships (document_id, user_id, role) VALUES (?, ?, ?)').bind(d.id, userId, 'owner'),
      env.DB.prepare('DELETE FROM guest_documents WHERE id = ?').bind(d.id),
    ])
    await indexTitle(d.id, d.title)
    await docStub(d.id).claim() // a normal room again: its next alarm indexes the text, tasks, and decisions
  }
  return rows.length
}

// A page that export, print, and slides can read: this browser's guest document, or a document the
// signed-in person may open. `back` is the page to return to.
export const requireReadable = async (request: Request, id: string) => {
  const own = await getGuestDocument(id, guestId(request))
  if (own) return { title: own.title, back: `/g/${id}` }
  const { document } = await requireDocument(request, id)
  return { title: document.title, back: `/doc/${id}` }
}
