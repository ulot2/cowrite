-- Onboarding. A space made from the welcome steps keeps its welcome document, and the "Get started"
-- steps that cannot be read from other tables: "opened" (the welcome document), "asked" (Nib), and
-- "hidden" (the card), as a comma list.
ALTER TABLE spaces ADD COLUMN welcome_doc TEXT;
ALTER TABLE spaces ADD COLUMN start_done TEXT NOT NULL DEFAULT '';
