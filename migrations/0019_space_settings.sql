-- Space settings, changed by the owner. The profile: a logo (an uploaded image), a color behind the
-- first letter when there is no logo, and a one-line description. Nib on or off for the space. Who
-- may add documents: 'editor' (editors and the owner) or 'commenter' (commenters too).
ALTER TABLE spaces ADD COLUMN logo TEXT;
ALTER TABLE spaces ADD COLUMN color TEXT;
ALTER TABLE spaces ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE spaces ADD COLUMN nib INTEGER NOT NULL DEFAULT 1;
ALTER TABLE spaces ADD COLUMN add_docs TEXT NOT NULL DEFAULT 'editor';
