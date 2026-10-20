# Decision briefs — first increment

Questions can carry an optional brief: context, up to six named options with benefits and tradeoffs, and an optional recommended option with a reason. Ordinary discussions keep their existing composer.

## Flow

- Turn on “This needs a decision” when starting a discussion. “Add context and options” reveals the brief without making it a prerequisite for asking a quick question.
- Existing open questions have Add a brief or Edit brief. Drafts use explicit Save and Cancel; incomplete option names or a recommendation without reasoning show a recoverable error.
- The question shows the brief before the answer action. The recommendation is a proposal and never becomes a decision automatically.
- Opening a question starts at its heading and brief; new replies still bring the conversation forward.
- Answered or closed questions show the brief without editing controls. Reopening restores editing. Existing commenter access remains the permission to write; this increment does not change decision authority or approval policy.
- The source brief appears in the decision record, separate from the recorded outcome. Brief words are indexed for space search and included when Nib proposes next steps.

## Storage and collaboration

The existing discussion Y.Map contains a brief Y.Map. Context, recommendation, and reasoning are individual fields; options are keyed Y.Maps with stable IDs. No D1 migration is needed, and existing discussions without a brief continue to work.

Saving writes the fields changed from the original draft, preserving independent edits by other people. A conflicting edit already received from a collaborator asks the user to load the latest brief instead of silently overwriting it. Yjs resolves simultaneous edits to the same field through its existing conflict rules. Brief data is bounded and rendered as text.

Explicit decision recording now preserves the brief. See `decision-recording.md` for versioning, final choice and reasoning. Older plain answers still label the live source brief honestly. Decision-to-plan creation remains a later increment.

## Validation

Unit coverage checks bounded reading, validation, persistence, concurrent independent edits, stale edits, deletion conflicts, recommendation removal, and closed-question guards. Integration coverage checks live delivery, read-only viewers, reconnecting, decision-record rendering, search from brief-only words, and the existing decision and connected-work flows.

Typecheck and production build pass. All 32 relevant checks across decision briefs, decisions, discussions, Nib's space flows, and connected work passed. Browser verification covered adding a brief to an existing question, missing-reason validation, the custom recommendation picker, Save/Cancel, creating a question with a brief, and recording an answer with its source brief readable in the decision record.
