-- An invitation is a share link for one email address, made when "Add people" gets an email with no
-- account. It works once and expires after 14 days. Rows without an email are "anyone with the link".
ALTER TABLE share_links ADD COLUMN email TEXT;
