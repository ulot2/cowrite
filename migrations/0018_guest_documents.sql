-- Documents made without an account. The text lives in the document's room, as for any document;
-- this row says whose browser owns it (the `guest` cookie) and feeds the guest's list. On sign-up or
-- sign-in the row moves to `documents`, with the same id, so the room never moves.
CREATE TABLE guest_documents (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL,
  title TEXT NOT NULL,
  preview TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX guest_documents_guest ON guest_documents (guest_id, updated_at);

-- Counts per day, for limits that have no account to hang on (new guests per IP address).
-- `key` is a name and a one-way code, never an address.
CREATE TABLE daily_counts (
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
);
