# Affected plans in Needs attention

Home includes one Review plan row per affected plan the reader can confirm. These rows contribute to Waiting on you and the existing Review filter. Eligibility requires editing access to the plan, original decision and current decision, with a decided current outcome.

The space overview also lists affected plans the reader can open but cannot confirm. Eligible editors see You and sort with their other personal work; other readers see Editor review needed. A reopened, dropped or proposed current outcome is waiting for a decided outcome and never counts as a personal confirmable review. These waiting items stay visible in the relevant space, labeled Waiting for decision.

The primary title is the plan name. A secondary line names the current D-number, decision title and changed/waiting state. Home also identifies the space. No review deadline or assignee is invented, and the queue sends no notifications.

Review links go to the latest accessible decision with `?review=<plan-id>#plan-review-<plan-id>`. Accessible plans validate the selected ID; the normal comparison expands directly, receives focus and lands below the sticky top bar. It still uses the original plan's provenance when a replacement decision is displayed. Close/Cancel removes the selection while preserving other query fields. An unavailable or detached target displays a generic message without exposing the hidden plan.

The queue is derived from the decision index and latest acknowledgement, using the same version token and replacement-chain access rules as the existing review flow. There is no new migration, persistent dismissal or duplicate review request. Multiple plans for one decision remain separate rows; each plan appears once regardless of replacement-chain length. Home and space data reflect confirmation on the next navigation or refresh. Another decision revision brings the plan back while preserving all saved review history.

Candidates first require plan-document access. Source, every replacement in the chain and the latest reviewed decision basis are checked before a row is returned. Private decisions cannot leak through a public or directly shared plan. Request-local caches share permission, decision and replacement lookups across plans. Reading the queue uses D1 only and does not start a document room, AI request or assignment event.

The space queue is scoped to plans, original decisions or current decisions in that space, after all access checks. This keeps relevant work discoverable after a plan moves while hiding it from people who lost access. Home remains a personal queue; other people's readable reviews do not inflate Waiting on you.

## Validation

Typecheck and production build pass. All 30 targeted checks pass: nine attention cases, ten existing plan-review cases, six space-state cases and five task/decision/review-flow cases. Coverage includes separate rows for multiple plans, direct comparison links, readable versus actionable work, partial queue clearing, repeat confirmation, reopening, replacements, private source and plan permissions, membership removal and preserved history.

Browser verification covered the Home review count and Review filter, a space overview row, opening the selected comparison directly, the heading below the sticky top bar, Cancel removing the selection and restoring focus, confirmation followed by Home showing zero waiting items, and a real 390-pixel space layout with readable plan/decision text. Saved proof images remain in the ignored local preview directory.
