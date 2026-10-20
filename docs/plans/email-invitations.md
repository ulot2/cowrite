# Plan: email invitations

Status: step 1 built on 2026-09-30, with the recommended decisions (any holder of the link, 14 days). Step 1 also took the "Invited" list with **Copy link** and **Cancel** from section 5, so it works without email. The 20-a-day limit counts in `daily_counts`, so cancelling does not reset it. Not built yet: steps 2 to 4.

## The goal

An owner can share a document or a space with an email address that has no CoWrite account. The person gets an email with a link. They open it, sign up, and land in the document or space with the role the owner picked.

## Where we start from

- The share dialog and onboarding step 2 add people by email, but only people who already have an account. For anyone else, the owner sees "No account has that email. Ask them to sign up first." The dialog says "No email is sent."
- Share links (`/s/<token>`, table `share_links`) already do most of the work. The token is the permission. A signed-out person goes through `/login?next=/s/<token>`, and the login page sends them back after sign-up. `redeemShareLink` grants the role, unless the person already has a higher one.
- The app sends no email today.

An invitation is a share link with three differences: it is for one email address, it works once, and it expires.

## The design

### 1. Data: one new column

`migrations/0020_invitations.sql`:

```sql
-- An invitation is a share link for one email address. It works once and expires after 14 days.
ALTER TABLE share_links ADD COLUMN email TEXT;
```

A row with `email` set is an invitation. A row without `email` is the "anyone with the link" link, as today.

### 2. Server code

In `app/lib/access.server.ts`:

- `getShareLink`, `createShareLink`, and `revokeShareLink` add `AND email IS NULL`. As a result, the "one link per target" rule does not delete invitations.
- `findShareLink` ignores an invitation older than 14 days.
- New: `createInvite(target, id, email, role, userId)`. It deletes an earlier invitation for the same target and email, then inserts a new one. Inviting the same person again sends a new link.
- New: `listInvites(target, id)` and `cancelInvite(target, id, email)`.
- New: `invitesToday(userId)` counts the invitations that a person created in the last 24 hours.

In `app/routes/share.tsx`:

- If the link is an invitation, delete its row after the visit, whether or not it granted a role. The log line is "accepted an invitation as editor".
- If the person is signed out and the link is an invitation, send them to `/login?next=/s/<token>&mode=up`, so that the page opens on sign-up.

In `app/lib/db.server.ts`, `deleteDocument` also deletes the document's rows in `share_links`. Today it leaves them, so an old link to a deleted document fails with a server error.

New file `app/lib/email.server.ts`, about 20 lines:

- `sendEmail({ to, subject, text, replyTo })` posts to the Resend API (`https://api.resend.com/emails`) with `fetch`. It needs no new dependency.
- If `RESEND_API_KEY` is not set (local development and tests), it sends nothing and returns `false`.
- If Resend refuses the email (for example, the 100-a-day free limit), it returns `false`. The invitation still exists, and the owner can copy its link.

### 3. The "add" action

`doc.tsx`, `space.tsx`, and `welcome.tsx` share one helper, `addByEmail`, so that the three places cannot drift:

1. Make sure that the email looks like an email (one `@`, a dot after it, at most 254 characters), and make it lowercase.
2. If an account has the email, add the member as today.
3. If no account has it and the owner created 20 or more invitations in the last 24 hours, refuse: "You sent 20 invitations today. Try again tomorrow." This limit stops a person from using CoWrite to send spam.
4. Otherwise, create the invitation and send the email. Return `{ invited: email, sent: true | false }`.

Onboarding step 2 stops refusing unknown emails. It invites them instead.

### 4. The email

Plain text, no HTML:

- From: `CoWrite <invites@cowrite.tnuell.sbs>` (the `EMAIL_FROM` variable)
- Reply-To: the owner's email, so that a reply goes to a person
- Subject: `Ada shared “Q4 plan” with you`
- Body:

```
Ada (ada@example.com) invited you to edit “Q4 plan” on CoWrite.

Open it: https://cowrite.cowrite.workers.dev/s/<token>

The link works once and expires in 14 days. If you did not expect this email, you can ignore it.
```

The link starts with `BETTER_AUTH_URL`, so it follows the app if you move it to another address.

### 5. The share dialog

- The hint under the email field becomes: "If they do not have an account, we email them an invitation."
- A new "Invited" group under the members. Each row shows the email, the role, **Copy link**, and **Cancel**. Only the owner sees it, as with the share link today.
- After an invitation, a short message: "Invitation sent to jane@example.com." If the email did not go out: "We could not send the email. Copy the link and send it yourself."

### 6. Test

One test in `test/sharing.test.js`: the owner adds an email with no account. The page shows an invitation link. A new account opens it and can read the document. A second visit to the same link gets a 404.

The tests run without `RESEND_API_KEY`, so they send no email.

### 7. Docs

- README: the "Share" step and the "How it works" part about links.
- PRODUCT.md: remove "no invitations … by email yet".

## Setup that you do

1. In Resend, add the domain `cowrite.tnuell.sbs`.
2. Add the DNS records that Resend shows (DKIM and SPF) where the DNS for `tnuell.sbs` lives. Also add a DMARC record for `tnuell.sbs` if it has none: `_dmarc` TXT `v=DMARC1; p=none`. Gmail and Yahoo reject bulk mail without DMARC, and it helps single emails too.
3. Wait until Resend shows the domain as verified.
4. Create a Resend API key with "sending access" only.
5. Store the key as a Worker secret:

```bash
npx wrangler secret put RESEND_API_KEY
```

6. I add `"EMAIL_FROM": "CoWrite <invites@cowrite.tnuell.sbs>"` to `vars` in `wrangler.jsonc`.

## Decisions

These are my recommendations. Tell me if you want a different one.

| Question | Recommendation | Why |
|---|---|---|
| Must the person sign up with the invited email? | No. The link works once, for whoever opens it. | Sign-up does not verify email addresses, so a check on the email adds no security. The single use and the expiry limit a forwarded link. |
| How long does an invitation last? | 14 days | Long enough for a slow reader. Short enough that old links in inboxes stop working. |
| Also email people who already have an account? | Not now | The bell already tells them. Add it with the daily digest, which needs the same `sendEmail`. |
| Move the app to `cowrite.tnuell.sbs` too? | Yes, later, as its own change | Email from one domain with links to another (workers.dev) looks a little more like spam. The move needs the DNS for `tnuell.sbs` on Cloudflare and a new GitHub sign-in callback URL. |

## Risks

- `.sbs` is a cheap domain ending, and some spam filters trust these less. DKIM, SPF, and DMARC help. The "Copy link" button is the fallback when an email lands in spam.
- The Resend free plan sends 100 emails a day for the whole app. That limit is shared by all users. The 20-a-day limit per person keeps one person from using all of it.

## Order of work

1. Migration, `access.server.ts` changes, and `share.tsx`. Invitations work with "Copy link" and no email. Test.
2. `email.server.ts` and the email. Works after your setup steps.
3. Share dialog and onboarding changes.
4. Docs.

Phase 1 is useful by itself, so it can ship before your DNS is ready.
