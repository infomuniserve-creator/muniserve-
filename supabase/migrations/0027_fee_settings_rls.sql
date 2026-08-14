-- RLS for the two new BPLO-facing Settings controls (2026-08-14 follow-up
-- to migration 0026): the Regulatory Fees manager and the Automated
-- Assessment toggle. Neither `fee_rules` nor `lgus` had a staff-facing
-- write policy before this -- fee_rules has only ever been written via
-- migrations/seed scripts (service-role), and lgus' only write policy is
-- platform-admin-only (migration 0018).

-- Scoped to fee_category = 'regulatory' specifically, not every fee_rules
-- row -- this is the one self-service editing surface shipping in this
-- pass (flat regulatory fees only). LBT schedules and the Mayor's Permit
-- catalog/tier-matrix stay a service-role/migration task for now (see
-- CLAUDE.md's note on this pass's scope) -- not opening broader write
-- access than what's actually being used, so a future bug can't touch
-- legally-sensitive tax schedules through a path that was never built
-- with the same safeguards (e.g. "new schedules start inactive").
create policy "bplo can manage regulatory fees at their own lgu"
on fee_rules for all
using (
  lgu_id = (select lgu_id from current_staff())
  and (select role from current_staff()) = 'bplo'
  and fee_category = 'regulatory'
)
with check (
  lgu_id = (select lgu_id from current_staff())
  and (select role from current_staff()) = 'bplo'
  and fee_category = 'regulatory'
);

-- BPLO can flip their own LGU's automated_assessment_enabled -- same
-- "RLS bounds which rows, not which columns" caveat migration 0015
-- already flagged for setStaffActive: the action code itself only ever
-- writes this one column, never forwards arbitrary form fields.
create policy "bplo can update their own lgu's settings"
on lgus for update
using (
  id = (select lgu_id from current_staff())
  and (select role from current_staff()) = 'bplo'
)
with check (
  id = (select lgu_id from current_staff())
  and (select role from current_staff()) = 'bplo'
);
