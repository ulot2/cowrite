-- Explicit relationships complement the source links already held in documents
-- and space rooms. Linking work never changes either item's access permissions.
CREATE TABLE work_links (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('related', 'implements')),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(source, target, relation)
);
CREATE INDEX work_links_source ON work_links(source);
CREATE INDEX work_links_target ON work_links(target);
