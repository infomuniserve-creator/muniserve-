-- Print-ready certificate at "For Printing" (CLAUDE.md 7x): the pre-
-- signature copy BPLO prints and carries to the Mayor needs the Mayor's
-- actual name on it ("HON. JOHN A. ALVAREZ" on the project owner's real
-- reference permit) -- there was nowhere to store this before. Nullable,
-- same fallback-if-unset convention as display_name/bplo_office_name
-- (migration 0017) -- unlike those, there's no sensible generic default
-- for a person's actual name, so a client who hasn't set this yet just
-- gets a blank signature block instead of a guessed placeholder.

alter table lgus add column mayor_name text;
