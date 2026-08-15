-- Fixes a real, actively-reproducing production bug: `current_staff()`
-- (the SQL function nearly every RLS policy in this schema calls) did
-- `select * from staff_users where auth_user_id = auth.uid() limit 1`
-- with no ordering. Harmless when an auth_user_id has exactly one
-- staff_users row -- but a platform admin who has ever used "View as"
-- (migration 0019, CLAUDE.md 7o follow-up) legitimately owns TWO rows
-- for the same login when that Google account is also real client staff
-- somewhere: the real row, and the reusable admin-proxy row "View as"
-- upserts. `limit 1` with no order by then returns whichever row Postgres
-- feels like -- observed live (get_runtime_errors, 2026-08-14/15,
-- /dashboard/treasury): a platform admin used "View as Treasury", but
-- `current_staff()` kept returning their real San Miguel BPLO row
-- instead of the treasury proxy row, so `role = 'treasury'` in the
-- payments INSERT policy evaluated false and every payment got rejected
-- with a bare RLS error -- no code bug in recordPayment() itself at all.
--
-- The TypeScript-side equivalent, src/lib/staff.ts's getCurrentStaff(),
-- already solved this exact problem (same 7o incident, different
-- session): "the active admin-proxy row always wins over a real
-- account... once it's deactivated, the same person's own real account
-- works normally again." That fix only ever touched the app layer --
-- every RLS policy across the whole schema (applications, businesses,
-- payments, permits, department_reviews, fee_rules, lgus, staff_users,
-- audit_log, ...) still calls this same unordered SQL function, so the
-- identical class of bug that caused 7q's "Unknown applicant" gap (app
-- layer and DB layer silently diverging) was still live here. This
-- migration brings current_staff() up to the same precedence, so a
-- platform admin's "View as" session is finally reliable at the
-- database layer everywhere, not just in what dashboard/page.tsx's own
-- router happens to check.

create or replace function public.current_staff()
returns staff_users
language sql
stable security definer
set search_path = 'public'
as $function$
  select * from staff_users
  where auth_user_id = auth.uid()
  order by
    case
      when is_admin_proxy and is_active then 0
      when not is_admin_proxy and is_active then 1
      else 2
    end
  limit 1;
$function$;
