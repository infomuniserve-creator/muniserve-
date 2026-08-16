-- Lets BPLO toggle whether CEDULA is folded into the online assessment
-- total or stays a Treasury-counter, upload-proof reference line (Settings,
-- CLAUDE.md follow-up). fee_rules already has an UPDATE-shaped policy per
-- category for BPLO (migration 0027 for 'regulatory', 0028 for 'lbt'/
-- 'mayors_permit') -- 'cedula' was never covered, so BPLO had no write
-- access to these two rows at all before this.
--
-- UPDATE-only, narrower than the other two fee-category policies (which
-- grant ALL) -- this feature only ever flips delivery_mode on the two
-- existing CEDULA rows (individual/juridical), seeded once at LGU
-- onboarding; nothing in the product ever creates, deletes, or otherwise
-- edits a CEDULA fee_rules row.
create policy "bplo can update cedula delivery mode at their own lgu"
on fee_rules for update
using (
  lgu_id = (select lgu_id from current_staff())
  and (select role from current_staff()) = 'bplo'
  and fee_category = 'cedula'
)
with check (
  lgu_id = (select lgu_id from current_staff())
  and (select role from current_staff()) = 'bplo'
  and fee_category = 'cedula'
);
