-- Publishing: a document points at the version the public page shows.
ALTER TABLE documents ADD COLUMN published_slug TEXT;
ALTER TABLE documents ADD COLUMN published_version INTEGER;
ALTER TABLE documents ADD COLUMN published_at INTEGER;
CREATE UNIQUE INDEX documents_published_slug ON documents(published_slug);

-- Full-text search. One row per document and kind (title, body, comments).
CREATE VIRTUAL TABLE search USING fts5(document_id UNINDEXED, kind UNINDEXED, text);
INSERT INTO search (document_id, kind, text) SELECT id, 'title', title FROM documents;
INSERT INTO search (document_id, kind, text) SELECT id, 'body', preview FROM documents WHERE preview != '';
