-- Add legacy_owner_name to businesses
--
-- Discovered while importing the legacy business roster
-- (reference/legacy-data/BPLO_LBT_Backfill_v2.csv). The legacy-claim flow
-- (CLAUDE.md section 5) shows a masked confirmation ("Is this your
-- business?") when an applicant looks up a business by legacy_license_no --
-- but that confirmation needs to reference something the applicant would
-- recognize (the business name and/or the name on file) BEFORE a phone
-- number is attached and an owners row exists. `businesses.owner_id` is
-- null for every unclaimed legacy record, so there was nowhere to keep the
-- name from the old paper/spreadsheet records. This is that place --
-- explicitly NOT a foreign key to `owners`, since it's pre-claim data that
-- may not even match cleanly (misspellings, maiden names, etc.) and isn't
-- meant to be authoritative once the business is actually claimed.

alter table businesses
  add column legacy_owner_name text;

comment on column businesses.legacy_owner_name is
  'Owner name from the pre-migration legacy records, kept only for the '
  'claim flow''s masked confirmation screen. Not a source of truth once '
  'owner_id is set -- at that point owners.full_name is authoritative.';
