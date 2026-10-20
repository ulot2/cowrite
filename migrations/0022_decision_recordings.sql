-- Each explicit recording keeps its own immutable choice, rationale and brief.
-- Reopening preserves the current recording; recording again appends a version.
ALTER TABLE decisions ADD COLUMN recording_id TEXT;
CREATE TABLE decision_recordings (
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (decision_id, id)
);
