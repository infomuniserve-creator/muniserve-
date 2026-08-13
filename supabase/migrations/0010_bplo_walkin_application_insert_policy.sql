-- BPLO walk-in applications (Business Registry "start on their behalf" action).
--
-- Every applications row up to now was created by the applicant-facing
-- submit-application route via the service role, which bypasses RLS by
-- design -- so there was no staff-side INSERT policy on applications at
-- all. The Business Registry's walk-in action (a business owner renewing
-- or reactivating in person at the counter, per the "let BPLO start an
-- application for a walk-in" scope decision) creates the row through
-- BPLO's own RLS-scoped session instead, matching this project's
-- standing preference for the acting staff member's own session over
-- service-role wherever a real policy can express the check.
--
-- Requires the referenced business to belong to BPLO's own LGU too, not
-- just trusting the lgu_id column the request sends -- same defense-in-
-- depth shape as the payments/permits policies' applications join in
-- migration 0002.

create policy "bplo can create applications at their own lgu"
on applications for insert
with check (
  (select role from current_staff()) = 'bplo'
  and lgu_id = (select lgu_id from current_staff())
  and exists (
    select 1 from businesses b
    where b.id = applications.business_id
      and b.lgu_id = (select lgu_id from current_staff())
  )
);
