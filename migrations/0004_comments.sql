-- Open comment threads, counted by the Doc object a few seconds after a change. For the cards.
ALTER TABLE documents ADD COLUMN open_comments INTEGER NOT NULL DEFAULT 0;
