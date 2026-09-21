-- Review workflow: a document is a draft, in review, or approved.
ALTER TABLE documents ADD COLUMN status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved'));

-- When each person last opened the bell. Notifications are the events after that time.
CREATE TABLE inbox_seen (
  user_id TEXT PRIMARY KEY,
  seen_at INTEGER NOT NULL
);
