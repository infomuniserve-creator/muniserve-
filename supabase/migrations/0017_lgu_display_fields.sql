-- Multi-LGU fix, part 1 -- see CLAUDE.md section 7n. The LGU's exact
-- letterhead wording ("Municipality of X" vs "City of X", "Office of the
-- Municipal..." vs "Office of the City...") isn't safely derivable from
-- name + province alone -- it genuinely varies by LGU type/preference,
-- so these are explicit, overridable text columns rather than a formula.
-- Nullable with a code-level fallback (src/lib/lgu.ts) so this doesn't
-- become a second thing every future LGU onboarding step must remember
-- to fill in.

alter table lgus add column display_name text;      -- e.g. 'Municipality of San Miguel Bulacan'
alter table lgus add column bplo_office_name text;   -- e.g. 'Office of the Municipal Business Permit and Licensing Officer'

update lgus set
  display_name = 'Municipality of San Miguel Bulacan',
  bplo_office_name = 'Office of the Municipal Business Permit and Licensing Officer'
where name = 'San Miguel';
