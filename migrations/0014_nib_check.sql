-- Nib's check of a document against the decisions in force and the open questions. The document's
-- object runs it from its alarm and writes the result here.
-- check_state: pending | done | failed. check_findings: a JSON array of { kind, text, ref }.
ALTER TABLE documents ADD COLUMN check_state TEXT;
ALTER TABLE documents ADD COLUMN check_findings TEXT NOT NULL DEFAULT '[]';
ALTER TABLE documents ADD COLUMN check_at INTEGER;
