-- Fixes a real, currently-live CRITICAL cross-tenant RLS gap, found during a
-- full-system audit (2026-08-20, security pass). "department scoped access
-- to department_reviews" (migration 0002) matched purely on department NAME
-- ('Engineering' = 'Engineering') with no join back to review_rounds/
-- applications to also check lgu_id -- unlike every other policy on this
-- table ("bplo full access", "treasury and mayor can view", migration 0047),
-- which all correctly join through to applications.lgu_id.
--
-- Because two real live clients (San Miguel and a second onboarded LGU) both
-- use standard department names that collide (Engineering, MENRO, MHO), a
-- genuine department-reviewer account at one LGU could SELECT/UPDATE/DELETE
-- the OTHER LGU's department_reviews rows for a same-named department --
-- including department_reviews.assessed_amount (the Engineering-typed
-- Building Permit Fee, section 7aa) that feeds directly into what an
-- applicant is actually charged. Confirmed live against production before
-- writing this fix: a real 'Engineering' department account at the second
-- client could read all of San Miguel's real department_reviews rows.
--
-- Fixed by adding the identical join every other policy on this table
-- already uses (migration 0047 is the direct template).
drop policy "department scoped access to department_reviews" on department_reviews;

create policy "department scoped access to department_reviews" on department_reviews for all
using (exists (
  select 1
  from staff_users s
  join review_rounds r on r.id = department_reviews.review_round_id
  join applications a on a.id = r.application_id
  where s.auth_user_id = auth.uid()
    and s.role = 'department'
    and s.department = department_reviews.department
    and s.lgu_id = a.lgu_id
));
