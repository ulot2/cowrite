# Review affected plans

A plan keeps its original decision provenance. When that decision is revised, reopened, dropped or replaced, the decision page marks the plan as needing review. A replacement decision also lists accessible plans from the decisions it replaces. Each plan and its original decision are checked separately for access.

Review decision change opens an inline comparison. Its left side shows the original choice and recorded reasoning, or the last reviewed decision when a review already exists. Its right side shows the current choice and reasoning. Replacement chains follow the latest accessible decision. A missing historical rationale is labeled honestly; the editable plan text is never treated as a historical snapshot.

Open plan to review or edit opens the normal editor in another tab, leaving the comparison available. People edit the actual goal and task blocks there. The review itself never overwrites content, completes work, changes owners or sends assignment notifications.

An editor of the original decision, current decision and plan can choose Plan still applies or I updated the plan, explicitly acknowledge reviewing the goal and tasks, and confirm. Updated plans require a short note about the changes. Reviewers and viewers may read the comparison and history but cannot confirm. An open or dropped current decision blocks confirmation until a current decided outcome exists.

Migration 0024 adds an append-only review history with the decision ID, exact version and snapshot, reviewer, date, outcome, note and preceding review sequence. The original plan source version remains unchanged. The current marker follows the latest review, so another decision revision needs another review. Review history shows the latest 20 entries; older entries remain stored. History content is checked against access to its decision before it is returned.

Confirmation rechecks both decision/plan permissions, the indexed decision and the live source room. A single conditional insert checks the current replacement chain, source fields and preceding review sequence. Concurrent confirmations create one next review; a completed retry returns the existing acknowledgement. A chain that returns to a previously reviewed decision can receive a fresh review without losing the intervening history.

Comparison loading, recoverable errors and reloading are explicit. Errors retain the note, while reloading resets the choice and acknowledgement so the updated decision is reviewed deliberately. Canceling or closing creates no review. The completed review shows its author and date, and the plan row updates without changing its task progress.

## Validation

Typecheck and production build pass. All 10 review tests, eight existing plan tests and eight sharing tests pass. The sharing suite was rerun after a local ProxyWorker connection drop affected a space-settings request. Review coverage includes immutable comparisons, read-only and removed access, stale confirmations, simultaneous confirmation and retries, another revision, the live reopen/indexing window, replacement chains and a return to a previously reviewed version.

Browser verification covered the comparison, an unselected outcome and disabled confirmation, editing an actual task in the normal editor, the required updated-plan note and acknowledgement, successful confirmation, the updated plan row, unchanged task progress, saved reviewer/date/note/snapshot history and a stacked comparison at 390 pixels. The finish review found no outstanding material issues.
