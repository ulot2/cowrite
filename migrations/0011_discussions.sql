-- Space discussions. The space's room (a Doc object named "<space id>:space") holds them as Yjs
-- data; these rows are an index its alarm rewrites, for the space home and the bell.
CREATE TABLE discussions (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,        -- talk | question
  status TEXT NOT NULL,      -- open | answered | closed
  owner_id TEXT,             -- questions: who must answer
  due TEXT,                  -- questions: decide by (YYYY-MM-DD)
  posts INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX discussions_space ON discussions(space_id, last_at);

-- A task can come from a discussion post. Its row has document_id = '' and these two set.
ALTER TABLE tasks ADD COLUMN space_id TEXT;
ALTER TABLE tasks ADD COLUMN discussion_id TEXT;
CREATE INDEX tasks_space ON tasks(space_id);
