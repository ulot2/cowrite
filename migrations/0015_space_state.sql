-- The state of a space: a short summary Nib writes from live facts, saved and reused.
-- state_state: pending | done | failed.
ALTER TABLE spaces ADD COLUMN state_text TEXT NOT NULL DEFAULT '';
ALTER TABLE spaces ADD COLUMN state_at INTEGER;
ALTER TABLE spaces ADD COLUMN state_state TEXT;

-- What an event is about, when that is not a document: a discussion, a decision, or the ideas board.
ALTER TABLE events ADD COLUMN link TEXT;
