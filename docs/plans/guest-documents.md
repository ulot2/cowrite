# Plan: documents without an account

Status: phases 1 to 3 built on 2026-09-25, with the recommended answers to the four decisions (30 days, 10 documents, Nib off, the playground becomes the first document). Not built yet: the 2 MB size cap from section 5, and phase 4.

## The goal

A person can create documents, edit them, and download them without signing up. If they sign up or sign in later, the documents become theirs and stay.

## Where we start from

The playground (`/play`) already does most of this for one page:

- A random id in an HttpOnly cookie (`play`) identifies the browser. No account is needed.
- The page is a normal document room (a Durable Object), so the editor, suggestions, versions, and offline merging work.
- Export, print, and slides read it through `requireReadable` in `app/lib/play.server.ts`.
- The room writes nothing to D1, and it deletes itself 7 days after its last edit.

Guest documents take this from one page to many, and add one thing the playground cannot do: keep the work when the person signs up.

## The design

### 1. Who a guest is

A guest is a browser with a guest cookie: `guest=<random id>`, HttpOnly, Secure, SameSite=Lax, valid for 30 days and renewed on every visit. The playground cookie becomes this cookie, so a browser has one guest id, not two.

The cookie is the only key. Anyone who uses the same browser can open the documents. The pages say so.

### 2. Where guest documents live

- **The text:** in a document room, as today. A guest document gets a normal document id, so its room never has to move.
- **The list:** a new D1 table, `guest_documents` (`id`, `guest_id`, `title`, `preview`, `created_at`, `updated_at`). The guest's document list and the ownership check read it.
- **No other D1 rows:** a guest document is not in `documents`, search, tasks, decisions, or events. The room's alarm checks which table the id is in. For a guest document it writes only the title's preview and the edit time to `guest_documents`, and it skips the search index, tasks, decisions, and events.

### 3. What a guest can do

| Feature | Guests | Why |
|---|---|---|
| Create, rename, delete documents | Yes | The goal |
| Write, format, tables, tasks, decisions | Yes | The editor works as it is |
| Suggestions, versions, restore | Yes | They live in the room |
| Download (Word, Markdown, text), print to PDF, slides | Yes | The goal. `requireReadable` learns guest documents |
| Offline editing | Yes | Works as it is |
| Comments and mentions | No | They need a name and an account to notify |
| Sharing with other people | No, at first | Sharing needs accounts. A read-only link can come later |
| Spaces | No | A space is a team; a team needs accounts |
| Nib | No, at first | It costs AI allowance. Later, a small daily quota like the FAQ's |
| Images | No, at first | Uploads need abuse limits. Later, with a size and count quota |

### 4. Keeping the work: claim on sign-up or sign-in

When someone signs up or signs in while the browser has a guest cookie with documents:

1. The server finds the guest's rows in `guest_documents`.
2. In one D1 batch, each row becomes a row in `documents` (owner: the new account) and an owner row in `memberships`, and the `guest_documents` row is deleted.
3. The rooms do not move, because the ids stay the same. The next alarm indexes each document like any other.
4. The guest cookie is cleared.

This runs at the first page after sign-in: the `/welcome` loader for a new account, and the home loader for an existing one. A new account that brings documents skips "name your first space" and lands on its Documents page with a note: "Your 3 documents are saved to your account."

### 5. Limits and cleanup

- **Documents per guest:** at most 10. The 11th asks the person to sign up.
- **New guests per IP address:** at most 20 a day, counted like the FAQ limit (a one-way code, never the address).
- **Size:** a new cap for guest rooms: the room stops taking edits after 2 MB of updates. Rooms have no size cap today.
- **Expiry:** a guest document is deleted 30 days after its last edit. Its room deletes itself, as the playground's does, and the same alarm deletes its `guest_documents` row.

### 6. Pages

- **`/g` — the guest's documents.** A list like the Documents page, with **New document** and one line at the top: "You are not signed in. These documents are kept in this browser for 30 days. Sign up to keep them and to write with other people."
- **`/g/<id>` — a guest document.** The editor, as in the playground, with **Export** and **Sign up to keep it**.
- **The landing page:** "Try it, no sign-up" opens `/g`, or the guest's newest document when there is one. The playground becomes the guest's first document, so edits made there can be kept too.

## Phases

1. **Guest documents.** The guest cookie, the `guest_documents` table (migration), create, list, open, rename, delete, the editor, and export. One test: a guest creates a document and downloads it, and another browser gets 404.
2. **Claim.** Keep the documents on sign-up and on sign-in. One test: a guest signs up, and the documents are in the new account with the same text.
3. **Limits and cleanup.** Documents per guest, new guests per IP address, expiry, and moving the playground into guest documents. One test: the 11th document is refused.
4. **Later, if wanted.** Nib with a daily quota, images with a quota, and a read-only share link.

## Decisions (answered on 2026-09-25)

1. A guest document is kept 30 days after its last edit.
2. A guest can have 10 documents.
3. Nib stays off for guests.
4. The playground became the guest's first document: "Try it" (`/play`) opens it. Old playground rooms (`play:<id>`) delete themselves when their alarm runs.

## Risks

- **A shared computer.** Anyone on the same browser can open the documents. The pages say this, and the person can delete a document at any time.
- **Abuse.** Free, anonymous storage attracts misuse. The limits in section 5 keep it small, and nothing a guest writes is public, because there is no sharing.
- **Two ways to own a document.** Every access check must know about guest documents. `requireReadable` and the WebSocket branch in `workers/app.ts` are the two places, and phase 1 changes both. The tests check that another browser cannot read a guest document.
