-- Staff account management UI (BPLO-facing) -- see CLAUDE.md section 7l.
-- Previously, provisioning a staff_users row was explicitly a service-
-- role/admin-only task (migration 0002's own comment says so) -- meaning
-- onboarding a new department reviewer, treasury clerk, or mayor account
-- required direct database access. This reverses that for BPLO
-- specifically, the same way 7h reversed 7d's identity-screen decision:
-- a real operational gap, not a bug, but a deliberate change worth
-- calling out plainly.

-- Safe to add: checked production first, zero duplicate/conflicting
-- emails exist today (only one staff_users row total). Needed so the
-- "claim by email on first sign-in" flow (auth/callback/route.ts) can
-- look up a pre-provisioned row unambiguously.
alter table staff_users add constraint staff_users_email_key unique (email);

-- BPLO can provision new staff at their own LGU (any role, including more
-- BPLO staff) and toggle is_active -- never a hard delete, matching the
-- rest of this schema's soft-delete convention (businesses.is_active,
-- lgu_departments.is_active). Column-level discipline (e.g. "only
-- is_active can be touched on an UPDATE, not role/lgu_id") is enforced
-- in application code (staff/actions.ts), not by this policy -- RLS here
-- only bounds which ROWS are reachable, not which columns of them.
create policy "bplo manages staff at their own lgu"
on staff_users for insert
with check (
  lgu_id = (select lgu_id from current_staff())
  and (select role from current_staff()) = 'bplo'
);

create policy "bplo updates staff at their own lgu"
on staff_users for update
using (
  lgu_id = (select lgu_id from current_staff())
  and (select role from current_staff()) = 'bplo'
)
with check (
  lgu_id = (select lgu_id from current_staff())
);
