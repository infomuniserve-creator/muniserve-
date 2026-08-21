-- Reverses migration 0060 (2026-08-21, same day) -- a manual "Fire
-- Department (BFP) Contact" Settings field duplicated data BPLO already
-- enters when adding a BFP staff account (staff_users.email/phone,
-- CLAUDE.md 7m/7w). fsif-notice.ts now looks up the LGU's own active BFP
-- staff account(s) directly instead of a separately-maintained field.
-- Confirmed before dropping: both columns are still null on every real
-- LGU, and no audit_log row ever referenced "bfp_contact_updated" -- zero
-- data loss.
alter table lgus drop column bfp_contact_email;
alter table lgus drop column bfp_contact_phone;
