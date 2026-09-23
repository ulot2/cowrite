# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Small teams and writers who draft, review, and agree on documents together: a plan, a spec, a proposal, meeting notes. They write at the same time, leave comments, suggest changes, and need to know when a document is approved and what was decided.

A second audience reads the public landing page: engineers and recruiters looking at CoWrite as a portfolio project. The page speaks to users first and gives this audience a short, honest "how it is built" part.

## Product Purpose

CoWrite is one place for a document's whole life: write it together live, review it with comments and suggestions, move it from draft to approved, and keep the tasks and decisions it produces inside the text. Success is a team that no longer copies a draft between a chat, an editor, a review tool, and a task list.

## Positioning

Word helps you write a document. CoWrite moves an idea from thought to finished, agreed work with other people, and remembers why. A space holds the whole piece of work: discussions and questions with a deadline, the decisions they produce, the tasks, and the documents. Everything is linked, so any decision can be traced back to the conversation that made it. Nib, the assistant, only ever suggests, and it will learn to read the whole space. Features that Google Docs already has are not the point; every addition must strengthen the chain from idea to discussion to decision to done.

## Operating Context

- People open a document in several tabs, devices, and places at once; cursors carry names. Edits made offline merge when the device reconnects.
- Documents live in spaces with members and roles: viewer, commenter, reviewer, editor, owner. Share by email or by link.
- A document can be published as a public page, exported (Markdown, Word, text, PDF), or presented as slides.
- New documents start from a mode: Write, Brainstorm (a board of cards), Plan (a template with goals, tasks, a decision, a timeline), or Review.

## Capabilities and Constraints

- Rich text editor (BlockNote on Yjs) with live cursors, comments with @mentions, suggestions, version history with compare and restore, activity timelines, a notification bell, search across text and comments.
- Tasks with an assignee and a due date, a Tasks page; decisions numbered per space (D-1, D-2) and a decision log.
- Nib: improve, fix, shorten, continue, summarize, extract action items, find contradictions, any free instruction (`@nib …`), and replies to `@Nib` in comments.
- Runs entirely on Cloudflare's free plan (Workers, Durable Objects, D1, R2, Workers AI) at $0. Nib shares a free daily allowance of a few hundred requests.
- Sign in with email and password; GitHub sign-in only when its secrets are set.
- Undecided: pricing (the product is free today; no paid plan exists), an email service (no invitations or digests by email yet).

## Brand Commitments

- Name: CoWrite, written "cowrite" in the italic serif wordmark (Instrument Serif), the logo mark in `app/components/logo.tsx`.
- The assistant is called Nib, marked with ✦.
- Voice: plain English, short sentences, active voice, no hype.
- The app's look ("Studio": white page, one cobalt accent, Manrope) is recorded in DESIGN.md.

## Evidence on Hand

- The live app: https://cowrite.cowrite.workers.dev, and the public repo: https://github.com/ulot2/cowrite (MIT license, 42 automated tests, CI deploys on every push).
- Real screens of the app that can be shown or rebuilt.
- None: no customers, testimonials, logos, usage numbers, or press. Do not invent any.

## Product Principles

1. The document is the source of truth. Tasks, decisions, and reviews live in it, not beside it.
2. People stay in control of changes: suggestions from people and from Nib wait for an accept.
3. Nothing is lost: offline edits merge, every version can be compared and restored.
4. Free to run and free to use; no feature depends on a paid service.

## Accessibility & Inclusion

Every control reachable by keyboard with a visible focus ring; text contrast at 4.5:1 or better in light and dark; motion off under reduced-motion; names on cursors as text, not only color.
