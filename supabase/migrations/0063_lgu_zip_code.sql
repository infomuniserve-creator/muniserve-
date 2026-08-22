-- Address-default fields on the applicant form (2026-08-22): Province and
-- City/Town were already available per-LGU (lgus.name/lgus.province,
-- already shown on every letterhead/subtitle) -- only Zip Code genuinely
-- didn't exist anywhere. No generic fallback, same convention as
-- mayor_name/treasurer_name/sender_name (migrations 0033/0039/0040) --
-- a client who hasn't set this yet just leaves the field blank on the
-- form, not a guessed placeholder.
alter table lgus add column zip_code text;
