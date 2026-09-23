-- Personal settings, one row per person who changed something. No row means the defaults.
-- color: an avatar color from the palette, or NULL for the one picked from the user id.
-- muted: a JSON array of notification kinds kept out of the bell (see app/lib/settings.server.ts).
-- nib: 1 when Nib, the writing assistant, is on for this person.
CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY,
  color TEXT,
  muted TEXT NOT NULL DEFAULT '[]',
  nib INTEGER NOT NULL DEFAULT 1
);
