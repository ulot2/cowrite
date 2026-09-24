-- Questions asked on the landing page, counted per day for the limits. `who` is a one-way code
-- made from the visitor's IP address, or '*' for the whole page. The questions are not kept.
CREATE TABLE faq_asks (
  day TEXT NOT NULL,
  who TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, who)
);
