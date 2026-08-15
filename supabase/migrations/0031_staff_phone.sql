-- Staff SMS notifications (CLAUDE.md 7w): staff_users had no phone
-- column at all before this -- notifyStaffEmail was the only channel,
-- deliberately, since email is guaranteed (staff's own Google login) and
-- phone wasn't collected anywhere. Nullable and unvalidated at the
-- schema level (normalized/validated app-side via src/lib/phone.ts's
-- normalizePhone(), same as owners.phone and businesses' other phone
-- fields -- no check constraint on those either, matching convention)
-- so a staff member without a phone on file simply never gets an SMS,
-- email-only, rather than blocking anything.

alter table staff_users add column phone text;
