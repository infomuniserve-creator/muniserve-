-- Fix infinite recursion in current_staff()
--
-- current_staff() (migration 0002) queries staff_users to find the caller's
-- own row. That's fine for policies on OTHER tables (lgus, fee_rules,
-- applications, ...) but staff_users' OWN select policy
-- ("staff can view staff at their own lgu", migration 0002) also calls
-- current_staff() -- which queries staff_users again, which re-evaluates
-- the same policy, which calls current_staff() again... Postgres detects
-- this as "infinite recursion detected in policy for relation staff_users"
-- the first time anyone actually runs the query. Caught while wiring up
-- the real staff dashboards (build order step 4), before it ever ran in
-- anger.
--
-- Fix: mark the function SECURITY DEFINER so its internal lookup bypasses
-- RLS entirely, breaking the cycle. Safe to do here specifically because
-- the function only ever returns auth.uid()'s own row -- there's no path
-- for a caller to use it to read anyone else's data. search_path is pinned
-- per Postgres's standard security-definer guidance (prevents a caller
-- from shadowing `staff_users` with an object earlier in their own
-- search_path to hijack what this function reads).

create or replace function current_staff()
returns staff_users as $$
  select * from staff_users where auth_user_id = auth.uid() limit 1;
$$ language sql stable security definer set search_path = public;
