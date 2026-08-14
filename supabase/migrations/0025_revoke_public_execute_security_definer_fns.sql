-- Security-advisor follow-up (2026-08-14, same day as 0023): current_staff()
-- and generate_application_reference() are both SECURITY DEFINER functions
-- that were exposed to `anon` over PostgREST's /rest/v1/rpc/ endpoint --
-- callable by anyone on the internet with zero authentication, no
-- different from a public API.
--
-- Traced every real caller in the codebase before touching this: both
-- functions are only ever invoked server-side, via service-role
-- (submit-application/route.ts) or an authenticated staff session
-- (businesses/actions.ts's walk-in flow) -- never via the anon key, and no
-- browser code calls .rpc() at all (grepped for it). So revoking anon's
-- ability to call these costs the app nothing.
--
-- Most concrete risk this closes: generate_application_reference(), called
-- anonymously with any lgu_id/year, would happily burn through that LGU's
-- real reference-number sequence (application_reference_counters) with no
-- actual application ever created behind it -- a free way to create gaps
-- or run a client's numbering far ahead of real usage.
--
-- A first pass at this (revoke ... from anon) turned out insufficient --
-- verified directly against information_schema.routine_privileges rather
-- than assuming it worked, and it hadn't: Postgres grants EXECUTE to the
-- PUBLIC pseudo-role by default when a function is created, and `anon`
-- inherits PUBLIC grants regardless of a REVOKE targeted at `anon`
-- specifically. This migration is the corrected version: revoke from
-- PUBLIC, then explicitly re-grant to the two roles that actually need
-- it. `authenticated` keeps it because current_staff() is called inside
-- RLS USING clauses across nearly every policy in this schema (evaluated
-- as the querying role for a real signed-in staff session), and the
-- walk-in flow also calls generate_application_reference() as an
-- authenticated BPLO session. `service_role` keeps it because the
-- applicant-facing submit-application route calls both that way.
revoke execute on function public.current_staff() from public;
revoke execute on function public.generate_application_reference(uuid, integer) from public;

grant execute on function public.current_staff() to authenticated, service_role;
grant execute on function public.generate_application_reference(uuid, integer) to authenticated, service_role;
