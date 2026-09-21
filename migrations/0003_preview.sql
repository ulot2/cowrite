-- The first lines of the text, written by the Doc object a few seconds after an edit. For the cards.
ALTER TABLE documents ADD COLUMN preview TEXT NOT NULL DEFAULT '';
