-- The lifecycle grows an Idea state before Draft and a Done state after Approved.
-- SQLite cannot change the CHECK on `status`, and rebuilding `documents` would cascade and delete
-- every membership. So a new column takes the new CHECK, the old one is dropped (its CHECK is its
-- own, which SQLite allows), and the new one takes the old name.
ALTER TABLE documents ADD COLUMN stage TEXT NOT NULL DEFAULT 'draft' CHECK (stage IN ('idea', 'draft', 'review', 'approved', 'done'));
UPDATE documents SET stage = status;
ALTER TABLE documents DROP COLUMN status;
ALTER TABLE documents RENAME COLUMN stage TO status;

-- Section sign-off: one row per person per section (a heading's block id) of a document in review.
-- text_hash is the section's text when it was signed, so the page can say "changed since".
CREATE TABLE signoffs (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('agree', 'concern')),
  note TEXT NOT NULL DEFAULT '',
  heading TEXT NOT NULL DEFAULT '',
  text_hash TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL,
  PRIMARY KEY (document_id, block_id, user_id)
);
