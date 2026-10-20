-- Confirmed plans are normal documents; this records their provenance and retry key.
CREATE TABLE decision_plans (
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  request_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (decision_id, created_by, request_id)
);
CREATE INDEX decision_plans_source ON decision_plans(decision_id);
