-- Decisions become records: what was decided, when, by whom, where it came from, and what it replaces.
-- source_type: document (a decision block) or discussion (an answered question, row id "q:<discussion id>").
-- supersedes: the id of the older decision this one replaces. "Replaced by" is read back from it.
ALTER TABLE decisions ADD COLUMN outcome TEXT NOT NULL DEFAULT '';
ALTER TABLE decisions ADD COLUMN source_type TEXT NOT NULL DEFAULT 'document';
ALTER TABLE decisions ADD COLUMN source_id TEXT;
ALTER TABLE decisions ADD COLUMN decided_by TEXT;
ALTER TABLE decisions ADD COLUMN decided_at INTEGER;
ALTER TABLE decisions ADD COLUMN supersedes TEXT;
UPDATE decisions SET source_id = document_id;
CREATE INDEX decisions_supersedes ON decisions(supersedes);
