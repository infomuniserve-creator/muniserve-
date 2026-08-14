-- Append-only activity/audit trail (CLAUDE.md 7o follow-up, 2026-08-14) --
-- the project owner asked for this directly with DILG compliance in mind:
-- a single, trustworthy, chronological record of every meaningful state
-- change, not scattered across the individual tables that already carry
-- some of this (applications.initial_review_by/at, department_reviews.
-- reviewer_id/reviewed_at/notes, payments.received_by, permits.issued_at,
-- etc.). Those columns stay exactly as they are -- this is a parallel,
-- denormalized, unified feed for reviewing/reporting/exporting, not a
-- replacement for them.
--
-- actor_label is captured as plain text at the moment of the event (e.g.
-- "Juan Dela Cruz (BPLO)"), not looked up live via a join -- the whole
-- point of an audit trail is that it stays accurate even if the acting
-- staff account is later renamed, deactivated, or removed.
--
-- application_id is nullable: not every event is application-scoped
-- (e.g. staff_added, lgu_paused).
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  lgu_id uuid references lgus(id) on delete cascade not null,
  application_id uuid references applications(id),
  actor_role text,
  actor_label text,
  action text not null,
  summary text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_lgu_id_created_at_idx on audit_log (lgu_id, created_at desc);
create index audit_log_application_id_idx on audit_log (application_id);

alter table audit_log enable row level security;

-- Any staff role can insert their own actions -- treasury/mayor/
-- department all log real events, not just BPLO.
create policy "staff can insert audit log rows for their own lgu"
on audit_log for insert
with check (lgu_id = (select lgu_id from current_staff()));

-- Only BPLO and Mayor can READ the trail -- rule #8 (a department
-- shouldn't see another department's queue) means a full activity feed
-- can't be opened to every role, and BPLO already sees across every
-- department by design (rule #9). The project owner explicitly asked for
-- Mayor to see this too, alongside BPLO.
create policy "bplo and mayor can view audit log at their own lgu"
on audit_log for select
using (
  lgu_id = (select lgu_id from current_staff())
  and (select role from current_staff()) in ('bplo', 'mayor')
);

create policy "platform admins manage audit log"
on audit_log for all
using (exists (select 1 from platform_admins where auth_user_id = auth.uid() and is_active = true))
with check (exists (select 1 from platform_admins where auth_user_id = auth.uid() and is_active = true));

-- Closes the one real gap in an otherwise-complete stage-timestamp
-- timeline (submitted_at, initial_review_at, review_rounds.opened_at +
-- department_reviews.reviewed_at, payments.received_at, printed_at,
-- permits.issued_at, released_at already exist) -- there was no captured
-- moment for "BPLO finished the fee assessment," needed for accurate
-- per-stage duration reporting (Performance Stats, same follow-up).
alter table applications add column assessment_finalized_at timestamptz;
