-- Delivery fee, per barangay (2026-08-22, project owner's own request):
-- an applicant choosing delivery should see what it costs before
-- deciding. Reuses fee_rules exactly like Barangay Clearance
-- (migration 0043) -- a uniform applies_to='all' row as the default,
-- overridden per-barangay by a row with applies_to='<barangay name>' --
-- rather than a new table, since the shape (one flat amount per
-- barangay, optionally uniform) is identical.
--
-- Deliberately never read by fee-engine.ts / computeApplicationFees() --
-- a delivery fee is a private arrangement between the applicant and the
-- courier (collected on delivery), not an official government fee that
-- belongs on the online assessment or Order of Payment. Living in
-- fee_rules is purely for reusing its existing "flat amount per
-- barangay, with a uniform fallback" shape and RLS pattern, not because
-- this is part of the fee-computation domain.
alter table fee_rules drop constraint fee_rules_fee_category_check;
alter table fee_rules add constraint fee_rules_fee_category_check
  check (fee_category in ('mayors_permit', 'lbt', 'cedula', 'regulatory', 'discount', 'barangay_clearance', 'delivery_fee'));

-- Same "widen one category at a time" shape as every other fee_rules
-- RLS pass (migrations 0027/0028/0038/0043).
create policy "bplo can manage delivery fees at their own lgu"
on fee_rules for all
using (
  lgu_id = (select lgu_id from current_staff())
  and (select role from current_staff()) = 'bplo'
  and fee_category = 'delivery_fee'
)
with check (
  lgu_id = (select lgu_id from current_staff())
  and (select role from current_staff()) = 'bplo'
  and fee_category = 'delivery_fee'
);
