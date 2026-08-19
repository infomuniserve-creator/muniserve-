-- Nothing has ever inserted into businesses through a real staff RLS
-- session before this -- every existing row came either from the
-- one-time legacy-roster seed script (service-role, bypassing RLS
-- entirely) or the applicant-facing submit-application route (also
-- service-role). The new self-service "Import Businesses" Settings
-- feature is the first staff action that needs to insert a businesses
-- row through the caller's own session, so there was no policy to reuse.
-- Same shape as the existing "bplo can update businesses at their own
-- lgu" policy (migration 0001/0002), just for INSERT instead of UPDATE.
create policy "bplo can insert businesses at their own lgu"
on businesses for insert
with check (
  lgu_id = (select current_staff.lgu_id from current_staff() current_staff)
  and (select current_staff.role from current_staff() current_staff) = 'bplo'
);
