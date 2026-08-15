-- Real workflow gap flagged live-testing (2026-08-15): a walk-in applicant
-- can pay at the Treasury counter, get handed an OR receipt, and bring it
-- straight to BPLO instead of separately finding a Treasury staff member
-- to log into their own dashboard and type it in. Before this, BPLO had no
-- way to record that payment themselves -- the application just sat at
-- pending_payment with no path forward except tracking down Treasury.
--
-- Same shape as rule #9's existing "BPLO can act on a department's behalf"
-- precedent (department_reviews' BPLO full-access policy) -- BPLO gains
-- the ability to do what Treasury does here (confirm payment, record an OR
-- number), not the ability to adjust what's owed. Rule #7's actual
-- restriction ("never adjust what's owed") is untouched: this policy only
-- covers the payments INSERT, nothing about application_fee_lines.
--
-- Additive alongside the existing Treasury-only policy (migration 0002),
-- not a replacement -- Postgres ORs multiple permissive policies together
-- for the same command, same pattern already used throughout this schema
-- (e.g. migration 0027's regulatory-fees policy sitting alongside the
-- original service-role-only posture).

create policy "bplo can record payments on behalf of treasury at their own lgu"
on payments for insert
with check (
  (select role from current_staff()) = 'bplo'
  and exists (
    select 1 from applications a
    where a.id = payments.application_id
      and a.lgu_id = (select lgu_id from current_staff())
  )
);
