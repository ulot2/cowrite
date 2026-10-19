# Connected work — first increment

The first improvement connects the existing idea → discussion → decision → document/task journey. It extends the Studio interface with one small native disclosure, rather than introducing another workspace or a graph editor.

## Behavior

- Documents, decisions, discussion threads, idea cards, and task rows have Connected work.
- Existing source relationships are derived from the current document/task/decision indexes and the actual board/discussion CRDT data. Old boards need no backfill.
- Direct connections show factual labels: Started from, Led to, Contains, Part of, Implements, Implemented by, or Related work.
- A wider chain is available on demand, up to three links away and 60 visible items. Indirect items say which item connects them; they are not presented as explicit implementation commitments.
- People with write permission can link existing items and remove explicit connections from either end. Source history is retained separately and cannot be accidentally removed with Unlink.
- A document or task can explicitly implement a decision. Related work is symmetric; implementation links always run from the decision to its implementation.
- Candidates are scoped to the current space, or to accessible standalone work from the same owner. Links do not grant access. Hidden/deleted items are omitted before traversal, so they cannot leak names or act as bridges to private work.
- Connections load only when expanded. Reopening or Refresh reads current titles, statuses, and source relationships. Explicit links survive source reindexing and version restoration; unavailable endpoints are not shown.
- The disclosure stays open while searching, connecting, removing links, or expanding the wider chain. It opts out of the app's transient-menu dismissal behavior.
- The linking form uses a searchable custom work picker with item icons, kinds, and statuses, alongside the app's custom relationship dropdown. Both use top-layer popovers, keyboard navigation, and Escape dismissal. The fields stack when the form is narrow.
- Task and idea links lead to their specific row/card, including a visible highlight. Decision and discussion links use the existing record/thread routes.

## Storage

`0021_connected_work.sql` adds `work_links` for explicit Related and Implements edges. The existing indexes and CRDT remain authoritative for native provenance and item content. No application documents, approval rules, or planning states are changed.

`app/lib/connections.server.ts` resolves the anchor's permission before loading its scope, filters every endpoint by its own visibility, and constructs the bounded chain. `/api/connections` authenticates reads and writes, validates endpoints, and checks current permissions again on mutations.

## Delivery

Apply migration 0021 using the project's normal migration/deployment process before deploying this version. Development and test databases use the same migration. This implementation does not deploy or migrate the live service.

Next increments remain separate: decision briefs/authority, living plans, guided decision-to-plan creation, approval policy, and task follow-through.

## Validation

Typecheck and production build pass. The 11 connected-work integration tests cover provenance, reciprocal and idempotent writes, reindexing, replacement history, permissions, hidden bridges, invalid endpoints, removal, standalone boards, and deletion. Regression runs also cover decisions, discussions, lifecycle, sharing, and thinking flows: 35 relevant tests passed in total.

Browser verification against an isolated sample workspace confirmed search and linking, removal without losing source history, persistent wider-chain expansion, and navigation from a decision to a highlighted task with its reciprocal connection already open.
