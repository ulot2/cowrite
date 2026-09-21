-- Spaces group documents and carry their own members. A public space is readable by anyone signed in who has the link.
CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  created_at INTEGER NOT NULL
);

CREATE TABLE space_memberships (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'reviewer', 'commenter', 'viewer')),
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX space_memberships_user ON space_memberships(user_id);

-- A document can live in one space, or in none.
ALTER TABLE documents ADD COLUMN space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL;
CREATE INDEX documents_space ON documents(space_id);

-- SQLite cannot change a CHECK constraint in place, so the memberships table is rebuilt with the two new roles.
CREATE TABLE memberships_new (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'reviewer', 'commenter', 'viewer')),
  PRIMARY KEY (document_id, user_id)
);
INSERT INTO memberships_new SELECT document_id, user_id, role FROM memberships;
DROP TABLE memberships;
ALTER TABLE memberships_new RENAME TO memberships;
CREATE INDEX memberships_user ON memberships(user_id);

-- "Anyone with the link" access. The token is the permission, so it is long and random.
CREATE TABLE share_links (
  token TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('document', 'space')),
  target_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'reviewer', 'commenter', 'viewer')),
  created_by TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX share_links_target ON share_links(target_type, target_id);
