-- owners had RLS enabled since migration 0001/0002 (alongside every other
-- staff-visible table) but was never actually given a policy of its own --
-- a real gap, not a deliberate lockdown (every other table in that
-- migration got a matching "staff can view X at their own lgu" policy;
-- owners was the one left out, most likely because it has no lgu_id
-- column of its own to naively copy the same pattern onto).
--
-- Confirmed live (2026-08-14, project owner testing "Mags Poultry Farm"):
-- every embedded `owner:owners(...)` join under a staff-scoped session --
-- owner names on every dashboard (bplo/businesses/department/mayor/
-- treasury pages), phone numbers for applicant SMS notifications
-- (bplo/actions.ts, treasury/actions.ts), the permit PDF's own
-- owner/representative field (mayor/actions.ts's signPermit) -- silently
-- returns null under RLS's default-deny rather than erroring the query,
-- which is exactly why this went unnoticed for so long: it degrades to a
-- plausible-looking fallback ("Unknown applicant"/"Unknown owner") or a
-- silently-skipped SMS instead of a visible crash. A real owner (Benj
-- Maglente, phone and full_name both correctly on file) showing as
-- "Unknown applicant" is what surfaced it.
--
-- Scoped the same "own LGU" boundary as every other table (rule #8's
-- spirit) -- a staff member can see an owner only if that owner has at
-- least one business at their own LGU, not every owner system-wide.
-- owners itself has no lgu_id column to check directly (deliberately --
-- one person's phone can genuinely span businesses in more than one LGU,
-- per CLAUDE.md section 5's identity model), so this goes through
-- businesses instead, mirroring how application_fee_lines/review_rounds/
-- payments/permits/documents/notifications_log (none of which have their
-- own lgu_id either) are already scoped via applications in migration
-- 0002.
create policy "staff can view owners linked to a business at their own lgu"
on owners for select
using (
  exists (
    select 1 from businesses b
    where b.owner_id = owners.id
    and b.lgu_id = (select lgu_id from current_staff())
  )
);

-- Same root gap also silently broke BPLO's walk-in claim-by-phone
-- (businesses/actions.ts's startWalkInApplication): finding an existing
-- owner by phone returned nothing (blocked by the same default-deny,
-- masquerading as "no match found"), and creating a brand-new owner row
-- failed outright (RLS blocks INSERT with no policy exactly like
-- SELECT). Not LGU-scoped in WITH CHECK -- owners has no lgu_id column to
-- check against, gated on role alone, the same trust boundary the
-- applicant-facing route already uses unscoped via service-role.
--
-- Known narrow edge case, not fixed here: if the phone number being
-- claimed belongs to an owner who has businesses only at a *different*
-- LGU (not this one), the SELECT policy above still won't surface them to
-- this LGU's staff, so the insert below will hit `owners.phone`'s unique
-- constraint and throw -- a clear, loud error for BPLO to notice and
-- escalate, not silent data corruption, so left as-is rather than
-- widening owner visibility across LGU boundaries to handle a rare case.
create policy "bplo can create owners"
on owners for insert
with check ((select role from current_staff()) = 'bplo');
