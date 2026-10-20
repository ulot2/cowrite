# Decision to plan

A current decided record has Create plan for editors and owners. The inline draft carries the final choice into the goal and the saved rationale into editable reasoning, with a clearly labeled three-task starter checklist. Task owners and dates start blank. Add or remove tasks (1–12), review the destination, then Confirm and create plan. Cancel and drafting have no server-side effects or assignments. No AI request is made; the checklist is explicitly a starting point to edit.

Confirmation rechecks source access, current status/replacement, recording version and the live room before the background index catches up. Validate title/goal/text limits, real calendar dates and task owners against current members. A normal plan document appears in the same space. Outside a space, it retains the source document's owner and memberships, so its source link remains visible to the same collaborators without granting ownership to an editor.

The document uses existing BlockNote XML and task blocks. Its source-decision link, goal, recorded choice, editable reasoning, selected owners/dates and task IDs are initialized once. D1 publishes the document, memberships, task index, implementation links, provenance row and creation/assignment events in one batch. Task and document links both use the existing Implements relation. The normal editor, Tasks page, search, exports and live synchronization continue to work.

The editor's people list includes inherited space members only when the reader can access that space, so task owner names and reassignment work for the team. The Share dialog still shows direct document memberships; this display change grants no new access and exposes no private space roster to an outside document-only reader.

Migration 0023 records confirmed plans and their source version, actor and confirmation key. The draft itself is only local UI state. Retrying an already completed confirmation returns its existing document. An unpublished seed's object ID includes the validated draft and source version: an edited retry after a failed database publication cannot silently reuse old task owners or content. The source predicate is checked again in the database transaction. A failed publication exposes no document or tasks.

The decision lists accessible plans with completed/total counts from the plan's current indexed tasks, including tasks added or removed later. Refresh progress or revisit to update those counts. A source revision, reopening or replacement marks the plan as based on an earlier version; it never rewrites the plan. Viewers can read existing plans/progress but cannot create them. A removed membership cannot reveal a hidden plan through this list.

This increment adds no milestones, dependency scheduling, AI generation, automatic assignments or separate planning subsystem. Progress follows normal task indexing; it is not continuous polling.

## Validation

Typecheck and production build pass. The plan/decision/connected-work run passed 26 cases; the final plan/access/sharing run passed 16, including eight plan cases and eight sharing cases (35 distinct cases across both runs). Coverage includes simultaneous and repeated confirmation, invalid/stale drafts, the live indexing window, real task completion and later task additions, source revisions, standalone ownership, inherited owners and a private space roster boundary.

Browser verification covered a single hydrated Create plan action, cancellation without creation, editing goal/tasks, custom owner dropdowns, committed native date input, empty-task validation with retained draft, disabled controls during confirmation, the normal editor with inherited owner names and dates, and completing a task then reading 1 of 3 tasks done on the source decision. Proof images are in the ignored local preview directory.
