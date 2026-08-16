-- Self-service barangay list (2026-08-16) -- migration 0021's
-- lgu_form_options only had a platform-admin RLS policy, written when the
-- only way to set a client's barangay list was /admin's create-client
-- form. Onboarding has since moved on without that step every time (it's
-- optional, CLAUDE.md 7o), and there was no way for BPLO to add or fix
-- their own barangay list afterward short of a raw SQL insert. This adds
-- a BPLO-scoped policy, additive alongside the existing platform-admin
-- one (Postgres ORs permissive policies together, same pattern used
-- throughout this schema).
--
-- Deliberately scoped to option_type = 'barangay' only, not
-- nature_of_business -- same "widen one category at a time" caution as
-- migration 0027 (regulatory fees only) before 0028 widened further.
-- nature_of_business already has a reasonable generic fallback
-- (lgu-form-options.ts) and its own conditional-logic coupling
-- (application-form-logic.ts) that a barangay list doesn't share, so it's
-- left as a service-role/admin task for now.
create policy "bplo can manage barangays at their own lgu"
on lgu_form_options for all
using (
  (select current_staff.role from current_staff()) = 'bplo'
  and lgu_id = (select current_staff.lgu_id from current_staff())
  and option_type = 'barangay'
)
with check (
  (select current_staff.role from current_staff()) = 'bplo'
  and lgu_id = (select current_staff.lgu_id from current_staff())
  and option_type = 'barangay'
);
