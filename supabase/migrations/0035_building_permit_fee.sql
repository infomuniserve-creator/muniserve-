-- Engineering-assessed Building Permit Fee (CLAUDE.md 7aa). A real,
-- separate fee from every other regulatory fee already in this schema:
-- under the National Building Code (PD 1096), the Office of the Building
-- Official (the Municipal Engineer's Office, in most LGUs) computes this
-- per square meter of floor area, construction cost, and occupancy type
-- -- there's no way for fee-engine.ts to compute it automatically (the
-- applicant form doesn't capture building plans/floor area/construction
-- cost), and it's genuinely not a fixed rate the way CNC/Plate Fee are,
-- so the existing flat Regulatory Fees mechanism (Settings) doesn't fit
-- it either. Engineering enters their own computed figure directly at
-- the moment they review, same "the specialist who actually knows the
-- number types it in" reasoning as everything else about this fee.
--
-- lgus.building_permit_fee_enabled: BPLO's on/off switch (Settings) --
-- off by default, so no LGU sees this field appear until BPLO turns it
-- on deliberately.
-- lgus.building_permit_fee_label: BPLO-editable display text, not
-- hardcoded "Building Permit Fee" -- this project's own reference
-- materials already show a naming ambiguity for San Miguel specifically
-- (a separate flat "Building Inspection Fee" also exists in an
-- unreconciled doc), so wording is left configurable rather than assumed
-- universal across LGUs. No generic fallback needed at the schema level
-- since "Building Permit Fee" is itself already a reasonable default,
-- unlike a person's name (mayor_name, migration 0033) -- the code layer
-- supplies that default when this is null.
alter table lgus add column building_permit_fee_enabled boolean not null default false;
alter table lgus add column building_permit_fee_label text;

-- department_reviews.assessed_amount: captured together with Engineering's
-- own decision (not a detached number), so it's audited exactly like
-- every other department action -- who assessed it and when is already
-- tracked the same way reviewer_id/reviewed_at track everything else on
-- this table. No new RLS policy needed: the existing department/BPLO
-- UPDATE policies on department_reviews (migration 0002) already bound
-- WHICH ROWS a session can touch, not which columns -- the same
-- "RLS bounds rows, not columns" convention setStaffActive and
-- setAutomatedAssessmentEnabled already rely on.
alter table department_reviews add column assessed_amount numeric;
