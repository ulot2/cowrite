-- A document is text (doc) or a brainstorm board (board). Same object, different content.
ALTER TABLE documents ADD COLUMN kind TEXT NOT NULL DEFAULT 'doc' CHECK (kind IN ('doc', 'board'));

-- Read-only indexes of the task and decision blocks inside documents. The document is the source;
-- the object's alarm rewrites these rows. No foreign keys: rows go with the document on delete by hand.
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  text TEXT NOT NULL,
  assignee_id TEXT,
  due TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX tasks_document ON tasks(document_id);
CREATE INDEX tasks_assignee ON tasks(assignee_id);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  space_id TEXT,
  owner_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX decisions_document ON decisions(document_id);
CREATE INDEX decisions_space ON decisions(space_id, number);
CREATE INDEX decisions_owner ON decisions(owner_id, number);
