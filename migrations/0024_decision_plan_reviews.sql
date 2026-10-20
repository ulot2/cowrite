-- Reviews acknowledge a decision version without changing the plan or its provenance.
CREATE TABLE decision_plan_reviews (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL REFERENCES decision_plans(document_id) ON DELETE CASCADE,
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  source_version TEXT NOT NULL,
  source_snapshot TEXT NOT NULL,
  previous_sequence INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL CHECK (outcome IN ('unchanged', 'updated')),
  note TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL,
  UNIQUE (document_id, previous_sequence)
);
CREATE INDEX decision_plan_reviews_latest ON decision_plan_reviews(document_id, sequence DESC);
