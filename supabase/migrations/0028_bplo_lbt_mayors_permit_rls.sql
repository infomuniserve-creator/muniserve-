-- Self-service LBT/Mayor's Permit Fee import (Business Tax & Mayor's Permit
-- Fee Setup, Settings). Widens migration 0027's "bplo can manage regulatory
-- fees" pattern to the two fee categories that were deliberately left
-- service-role-only at the time ("LBT schedules and the Mayor's Permit
-- catalog/tier-matrix stay a service-role/migration task for now").
--
-- That scope decision is what's changing here, on purpose: onboarding LGU #2
-- (and every one after it) showed the real bottleneck was never "should BPLO
-- be allowed to touch these rows" -- it's "there was no reviewed, structured
-- way for them to." The new CSV import flow (src/lib/fee-rule-import.ts)
-- provides that structure and a preview-before-publish step; this migration
-- is what lets its publish step actually write, through BPLO's own
-- RLS-scoped session rather than a developer's service-role connection --
-- rule #8's own reasoning ("enforced at the database layer, not just hidden
-- in the UI") applies here exactly as it did to every other staff write.
--
-- fee_rule_brackets has no lgu_id column of its own -- same join-through-
-- fee_rules shape migration 0002's read policy on this table already uses.

create policy "bplo can manage lbt and mayors permit fee rules at their own lgu"
on fee_rules for all
using (
  lgu_id = (select lgu_id from current_staff())
  and (select role from current_staff()) = 'bplo'
  and fee_category in ('lbt', 'mayors_permit')
)
with check (
  lgu_id = (select lgu_id from current_staff())
  and (select role from current_staff()) = 'bplo'
  and fee_category in ('lbt', 'mayors_permit')
);

create policy "bplo can manage brackets for their own lgu's lbt and mayors permit rules"
on fee_rule_brackets for all
using (
  exists (
    select 1 from fee_rules fr
    where fr.id = fee_rule_brackets.fee_rule_id
      and fr.lgu_id = (select lgu_id from current_staff())
      and (select role from current_staff()) = 'bplo'
      and fr.fee_category in ('lbt', 'mayors_permit')
  )
)
with check (
  exists (
    select 1 from fee_rules fr
    where fr.id = fee_rule_brackets.fee_rule_id
      and fr.lgu_id = (select lgu_id from current_staff())
      and (select role from current_staff()) = 'bplo'
      and fr.fee_category in ('lbt', 'mayors_permit')
  )
);
