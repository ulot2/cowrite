-- Activity. One row per thing that happened. No foreign keys: the log outlives what it describes.
-- `text` is the sentence tail written at the time ("renamed “A” to “B”"), so a row reads as actor + text.
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  space_id TEXT,
  document_id TEXT,
  actor_id TEXT NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX events_space ON events(space_id, at);
CREATE INDEX events_document ON events(document_id, at);
