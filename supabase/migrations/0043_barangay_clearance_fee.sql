-- Barangay Clearance fee (2026-08-17) -- the applicant form has always
-- had a "Do you have a barangay clearance?" question (Yes / "No,
-- generate my Brgy. clearance", straight off the real official form,
-- CLAUDE.md 7d) but fee-engine.ts never computed anything for the
-- "generate mine" answer -- a real, confirmed gap, not a guess.
--
-- Some LGUs charge the same clearance fee everywhere; some vary it by
-- barangay. Deliberately NOT a separate lgus.mode column -- same
-- reasoning as CLAUDE.md 7ff's cedulaIncludedOnline (computed live from
-- fee_rules rather than a second, potentially-drifting source of truth):
-- a fee_rules row with applies_to = '<barangay name>' overrides the
-- applies_to = 'all' uniform fallback for that one barangay, so an LGU
-- can be "mostly uniform, two barangays are different" without an
-- all-or-nothing switch, and there's no separate flag that could ever
-- disagree with what's actually configured.
alter table fee_rules drop constraint fee_rules_fee_category_check;
alter table fee_rules add constraint fee_rules_fee_category_check
  check (fee_category in ('mayors_permit', 'lbt', 'cedula', 'regulatory', 'discount', 'barangay_clearance'));

-- Same shape as migration 0027's "bplo can manage regulatory fees"
-- policy, scoped to this one new category only -- the same "widen one
-- category at a time" caution as every other fee_rules RLS pass.
create policy "bplo can manage barangay clearance fees at their own lgu"
on fee_rules for all
using (
  lgu_id = (select lgu_id from current_staff())
  and (select role from current_staff()) = 'bplo'
  and fee_category = 'barangay_clearance'
)
with check (
  lgu_id = (select lgu_id from current_staff())
  and (select role from current_staff()) = 'bplo'
  and fee_category = 'barangay_clearance'
);
