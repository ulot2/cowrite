# Record a decision

The discussion's Record decision action asks for the final choice and final reasoning, including accepted tradeoffs. Choose one named option with the existing custom Select, or write another approach. A recommendation is labeled but never selected automatically. Ordinary discussions can enter this flow through Nib's Review decision; nothing is recorded until the user finishes the same form.

Save or cancel brief edits first. While recording, brief editing is unavailable. The form retains failed submissions and checks that the saved brief has not changed since the form opened. Cancel restores focus to the trigger. Existing commenter permissions remain unchanged; viewers read only.

The shared discussion stores an atomic plain `recording` value with a UUID, title, choice, option ID, rationale, brief snapshot, person and timestamp. A keyed `recordings` map retains every version, including rapid record/reopen/rerecord sequences before the index alarm. Its normal answer fields remain populated for existing readers and indexes. New recordings are normalized and bounded before indexing.

Migration 0022 adds `decisions.recording_id` and `decision_recordings`. The room alarm inserts an immutable first payload per recording ID, and updates the decision's current pointer and outcome in the same D1 batch. Source edits and reindexing cannot overwrite an existing payload, and replaying an earlier ID cannot make it current. Deleting the discussion does not delete the decision or its versions; deleting the decision's space cascades history cleanup.

Reopening leaves the previous outcome, person, date and snapshot intact. Recording again creates another version under the existing D-number, and the record shows the earlier versions. On the first explicit replacement of a legacy plain answer, preserve the original answer/person/date as a clearly labeled legacy version with no invented rationale or brief. An untouched legacy answer still displays the current source brief, labeled as unsnapshotted.

The record separates final choice and final reasoning from the proposal preserved under Why. It retains Connected work, replacement links and source discussion links. Earlier snapshots remain readable when the source discussion is gone. Decision-to-plan creation remains a later increment.

Validation covers choosing against the recommendation, custom choices, missing rationale, stale briefs, duplicate submission guards, snapshot encoding, source edits, reopening, rerecording, old-ID replay, legacy preservation, permissions and connected-work regression.

Production build and typecheck pass. The six targeted suites contain 39 passing cases (the decision suite was rerun after correcting an assertion for a decision already marked Replaced). Browser verification covered the custom dropdown with keyboard selection, draft blocking, recoverable validation, recording an option, reopening and editing the source, confirming the unchanged original snapshot, and recording a custom revised outcome with readable earlier history.
