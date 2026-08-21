-- Fire Safety Inspection Fee (FSIF) notice (2026-08-21, CLAUDE.md) -- BFP
-- (Bureau of Fire Protection) works independently from the LGU and only
-- accepts the FSIF (RA 9514) through its own national e-BFP portal, never
-- through MuniServe. The applicant-facing notice sent right after BPLO's
-- initial approval tells them where to send proof of payment -- these two
-- fields are that contact info, BPLO-editable, no generic fallback (same
-- "no sensible default for a real per-LGU fact" reasoning as mayor_name/
-- treasurer_name, migrations 0033/0039).
alter table lgus add column bfp_contact_email text;
alter table lgus add column bfp_contact_phone text;
