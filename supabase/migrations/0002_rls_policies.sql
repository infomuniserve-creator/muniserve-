-- MuniServe Row Level Security
-- Source of truth: CLAUDE.md sections 2 (rule 7, 8, 9) and 4.
--
-- Two distinct trust boundaries in this app:
--   1. Staff (BPLO, treasury, mayor, department) authenticate via Supabase Auth
--      (Google OAuth) and have a matching row in staff_users keyed by auth_user_id.
--      RLS on staff-facing tables is enforced against auth.uid() below.
--   2. Applicants are passwordless (phone/email OTP via Semaphore/Resend, not
--      Supabase Auth) — they have no auth.uid(). All applicant-facing reads/writes
--      go through Next.js API routes using the Supabase service role key, with the
--      route itself checking a signed session (set after OTP verification) before
--      touching the DB. That means applicant tables must deny direct anon/
--      authenticated access entirely — RLS enabled, no permissive policy — so the
--      only path in is the service role, which bypasses RLS by design.
--
-- Enable RLS on every table up front. A table with RLS enabled and zero policies
-- denies all access to anon/authenticated roles — only the service role gets in.

alter table lgus enable row level security;
alter table lgu_departments enable row level security;
alter table fee_rules enable row level security;
alter table fee_rule_brackets enable row level security;
alter table owners enable row level security;
alter table otp_codes enable row level security;
alter table staff_users enable row level security;
alter table businesses enable row level security;
alter table applications enable row level security;
alter table application_fee_lines enable row level security;
alter table review_rounds enable row level security;
alter table department_reviews enable row level security;
alter table payments enable row level security;
alter table permits enable row level security;
alter table documents enable row level security;
alter table notifications_log enable row level security;

-- ============================================================
-- Helper: the staff_users row for the currently authenticated user
-- ============================================================

create or replace function current_staff()
returns staff_users as $$
  select * from staff_users where auth_user_id = auth.uid() limit 1;
$$ language sql stable;

-- ============================================================
-- staff_users — staff can see their own row and co-workers at their LGU;
-- nobody edits this from the client (provisioning is an admin/service-role task)
-- ============================================================

create policy "staff can view staff at their own lgu"
on staff_users for select
using (
  lgu_id = (select lgu_id from current_staff())
);

-- ============================================================
-- lgus / lgu_departments / fee_rules / fee_rule_brackets
-- Read-only reference data for any authenticated staff member of that LGU.
-- Writes are a service-role/admin task (LGU onboarding, rate changes) —
-- see rule #1: never a code change, but also never a bare client-side write.
-- ============================================================

create policy "staff can view their own lgu"
on lgus for select
using (id = (select lgu_id from current_staff()));

create policy "staff can view departments at their own lgu"
on lgu_departments for select
using (lgu_id = (select lgu_id from current_staff()));

create policy "staff can view fee rules at their own lgu"
on fee_rules for select
using (lgu_id = (select lgu_id from current_staff()));

create policy "staff can view fee rule brackets at their own lgu"
on fee_rule_brackets for select
using (
  exists (
    select 1 from fee_rules fr
    where fr.id = fee_rule_brackets.fee_rule_id
      and fr.lgu_id = (select lgu_id from current_staff())
  )
);

-- ============================================================
-- businesses / applications — any staff at the owning LGU can view.
-- Applicant-side create/update happens exclusively via service-role API routes.
-- ============================================================

create policy "staff can view businesses at their own lgu"
on businesses for select
using (lgu_id = (select lgu_id from current_staff()));

create policy "staff can view applications at their own lgu"
on applications for select
using (lgu_id = (select lgu_id from current_staff()));

-- BPLO can update application status (drive the state machine forward)
create policy "bplo can update applications at their own lgu"
on applications for update
using (
  lgu_id = (select lgu_id from current_staff())
  and (select role from current_staff()) = 'bplo'
);

-- ============================================================
-- application_fee_lines — rule #7: only BPLO overrides a computed amount.
-- Everyone else at the LGU can read the assessment; only bplo can write at all.
-- (computed_amount itself is written by the fee engine via service role.)
-- ============================================================

create policy "staff can view fee lines for their lgu's applications"
on application_fee_lines for select
using (
  exists (
    select 1 from applications a
    where a.id = application_fee_lines.application_id
      and a.lgu_id = (select lgu_id from current_staff())
  )
);

create policy "only bplo can override fee lines"
on application_fee_lines for update
using (
  (select role from current_staff()) = 'bplo'
  and exists (
    select 1 from applications a
    where a.id = application_fee_lines.application_id
      and a.lgu_id = (select lgu_id from current_staff())
  )
);

-- ============================================================
-- review_rounds — visible to any staff at the owning LGU
-- ============================================================

create policy "staff can view review rounds for their lgu's applications"
on review_rounds for select
using (
  exists (
    select 1 from applications a
    where a.id = review_rounds.application_id
      and a.lgu_id = (select lgu_id from current_staff())
  )
);

-- ============================================================
-- department_reviews — rules #8 and #9.
-- BPLO: full access to every department's reviews at their LGU (incl. proxy decisions).
-- Department staff: only rows matching their own department.
-- ============================================================

create policy "bplo full access to department_reviews"
on department_reviews for all
using (
  exists (
    select 1 from staff_users s
    join review_rounds r on r.id = department_reviews.review_round_id
    join applications a on a.id = r.application_id
    where s.auth_user_id = auth.uid()
      and s.role = 'bplo'
      and s.lgu_id = a.lgu_id
  )
);

create policy "department scoped access to department_reviews"
on department_reviews for all
using (
  exists (
    select 1 from staff_users s
    where s.auth_user_id = auth.uid()
      and s.role = 'department'
      and s.department = department_reviews.department
  )
);

-- ============================================================
-- payments — rule #7: treasury confirms payment, never adjusts fees.
-- Treasury inserts; everyone at the LGU (bplo, mayor, department, treasury) can read.
-- ============================================================

create policy "staff can view payments for their lgu's applications"
on payments for select
using (
  exists (
    select 1 from applications a
    where a.id = payments.application_id
      and a.lgu_id = (select lgu_id from current_staff())
  )
);

create policy "only treasury can record payments"
on payments for insert
with check (
  (select role from current_staff()) = 'treasury'
  and exists (
    select 1 from applications a
    where a.id = payments.application_id
      and a.lgu_id = (select lgu_id from current_staff())
  )
);

-- ============================================================
-- permits — only the mayor issues (sets issued_at). Everyone at the LGU can read.
-- ============================================================

create policy "staff can view permits for their lgu's applications"
on permits for select
using (
  exists (
    select 1 from applications a
    where a.id = permits.application_id
      and a.lgu_id = (select lgu_id from current_staff())
  )
);

create policy "only mayor can issue permits"
on permits for insert
with check (
  (select role from current_staff()) = 'mayor'
  and exists (
    select 1 from applications a
    where a.id = permits.application_id
      and a.lgu_id = (select lgu_id from current_staff())
  )
);

-- ============================================================
-- documents / notifications_log — visible to staff at the owning LGU.
-- Writes happen via service role (upload handler, notification dispatcher).
-- ============================================================

create policy "staff can view documents for their lgu's applications"
on documents for select
using (
  exists (
    select 1 from applications a
    where a.id = documents.application_id
      and a.lgu_id = (select lgu_id from current_staff())
  )
);

create policy "staff can view notifications for their lgu's applications"
on notifications_log for select
using (
  exists (
    select 1 from applications a
    where a.id = notifications_log.application_id
      and a.lgu_id = (select lgu_id from current_staff())
  )
);

-- ============================================================
-- owners / otp_codes — no client-side policies at all, intentionally.
-- These are applicant identity tables with no auth.uid() to check against.
-- All access must go through service-role API routes that enforce the OTP
-- session themselves. RLS is enabled above with zero policies, which denies
-- anon/authenticated access outright — this is the deny-by-default backstop,
-- not the primary enforcement (that's the API route's session check).
-- ============================================================
