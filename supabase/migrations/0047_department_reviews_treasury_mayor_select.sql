-- department_reviews has only ever had SELECT/write access for the bplo and
-- department roles (migration 0002) -- treasury and mayor logins have no
-- policy on this table at all, so an embedded department_reviews(...) join
-- from either of their own RLS-scoped sessions silently returns null rows
-- instead of erroring. Nothing reads it that way today, but it's the
-- identical shape to two real bugs already hit in this project (owners
-- had no policy at all until migration 0023; current_staff() picked the
-- wrong row until migration 0029) -- closing it now rather than waiting
-- for a future feature to hit it.
create policy "treasury and mayor can view department_reviews"
on department_reviews for select
using (
  exists (
    select 1 from staff_users s
    join review_rounds r on r.id = department_reviews.review_round_id
    join applications a on a.id = r.application_id
    where s.auth_user_id = auth.uid()
      and s.role in ('treasury', 'mayor')
      and s.lgu_id = a.lgu_id
  )
);
