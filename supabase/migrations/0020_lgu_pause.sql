-- Lets a platform admin pause a client (e.g. hasn't paid yet) without
-- touching any of their data, and later delete a client that was never
-- actually used (CLAUDE.md 7o follow-up, 2026-08-14).
--
-- paused_at is informational only (when it happened) -- is_paused is the
-- one column every check actually reads.
alter table lgus add column is_paused boolean not null default false;
alter table lgus add column paused_at timestamptz;
