-- Permit History, option 2: keep it growing, not frozen.
--
-- permit_history (migration 0011) started as a one-time import of San
-- Miguel's pre-MuniServe records (2020-2026) and had zero write policies
-- on purpose -- import was a service-role script, not an app feature.
-- Discussed with the project owner whether the historical Directory view
-- was still needed once Permit History existed; the answer was "yes, but
-- Permit History needs to stop being frozen at the import or it'll
-- silently drift out of date the moment MuniServe starts releasing real
-- permits." This is that fix's policy half -- mayor/actions.ts's
-- signAndRelease now inserts a permit_history row alongside the existing
-- permits row, through the Mayor's own RLS-scoped session, same as every
-- other action in this project that's naturally within the acting role's
-- own remit (see "only mayor can issue permits" in migration 0002 for the
-- same shape).
--
-- Simple lgu_id + role check, no extra join -- unlike payments/permits'
-- policies (which verify a client-supplied application_id actually
-- belongs to the caller's lgu), lgu_id here is always a server-derived
-- value (staff.lgu_id from the authenticated session, never client
-- input) inserted alongside an application row RLS already limited the
-- mayor to reading in the first place. Matches migration 0009's "bplo can
-- update businesses at their own lgu" policy's shape for the same reason.

create policy "mayor can add permit history entries at their own lgu"
on permit_history for insert
with check (
  (select role from current_staff()) = 'mayor'
  and lgu_id = (select lgu_id from current_staff())
);
