-- Fixes a real, confirmed production bug found during a full-system QA
-- sweep (2026-08-20): finalizeAssessment (bplo/actions.ts) has written
-- mode_of_payment = business.business_tax_payment since the Business Tax
-- installment-payments feature shipped (2026-08-19, migration 0052) --
-- "Annual" / "Bi-Annually" / "Quarterly". But this column's own CHECK
-- constraint (migration 0039, Order of Payment) was never updated to
-- match -- it still only allowed the OLD pre-0052 vocabulary ('Annual',
-- 'Semi-Annual', 'Quarterly'). Any renewal application where the
-- applicant chose Bi-Annually could never be finalized: the UPDATE inside
-- finalizeAssessment throws a raw 23514 constraint-violation error, and
-- the application is stuck at pending_bplo_assessment with no way
-- through. Quarterly happened to already be in the old list, so only
-- Bi-Annually was actually broken.
--
-- 'Semi-Annual' is dropped, not kept alongside the new value -- confirmed
-- directly against production first that zero rows currently use it
-- (only null and 'Annual' exist today), so there's nothing to preserve
-- backward compatibility for. Keeping a permanently-dead allowed value
-- around would just reintroduce the same "schema says one thing, code
-- says another" drift this migration exists to close.
alter table applications drop constraint applications_mode_of_payment_check;
alter table applications add constraint applications_mode_of_payment_check
  check (mode_of_payment = any (array['Annual'::text, 'Bi-Annually'::text, 'Quarterly'::text]));
