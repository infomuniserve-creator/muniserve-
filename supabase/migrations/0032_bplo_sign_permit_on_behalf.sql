-- BPLO can sign a permit on the Mayor's behalf (CLAUDE.md 7w follow-up).
-- Real physical process at this pilot LGU, given directly by the project
-- owner: BPLO prints the permit and personally carries it to the Mayor's
-- office, the Mayor signs it on paper, and BPLO carries the signed copy
-- back and records it in MuniServe -- the Mayor never opens the app for
-- this step. Before this, only a role = 'mayor' session could insert into
-- permits/permit_history at all, so there was no way to record what
-- actually happens without a real Mayor login doing it themselves.
--
-- Same "widen, don't replace" shape as migration 0030's payments policy
-- and rule #9's department-decision-on-behalf: the original mayor-only
-- policies are untouched, these are new additive grants (Postgres ORs
-- multiple permissive policies together). A genuine Mayor login still
-- works identically to before, for any LGU where that's how it's
-- actually done.

create policy "bplo can sign permits on behalf of the mayor at their own lgu"
on permits for insert
with check (
  (select role from current_staff()) = 'bplo'
  and exists (
    select 1 from applications a
    where a.id = permits.application_id
      and a.lgu_id = (select lgu_id from current_staff())
  )
);

create policy "bplo can add permit history entries on behalf of the mayor"
on permit_history for insert
with check (
  (select role from current_staff()) = 'bplo'
  and lgu_id = (select lgu_id from current_staff())
);
