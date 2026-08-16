-- Closing the "request more info" loop (2026-08-16) -- the project owner
-- tested BPLO's own initial-review "Request more info" and found it a
-- dead end: a generic SMS to "contact the BPLO office," no note shown to
-- the applicant, no way to upload what was asked for, and no way back in
-- short of a phone call or a counter visit.
--
-- A DEPARTMENT's own "request more info" already worked much better (the
-- applicant's status page already shows that department's note and an
-- upload box), but even there the loop wasn't fully closed: uploading a
-- document didn't automatically get the flagged department a fresh look
-- -- BPLO had to separately be told, then manually click "resubmit."
--
-- info_requests is the one shared record type behind all three reviewing
-- surfaces (BPLO's own initial review, any department, and now Treasury,
-- which never had a "request more info" mechanism at all) so there's one
-- consistent applicant experience (read the note, upload a file, done)
-- and one consistent auto-requeue behavior when they do, instead of three
-- separate ad hoc mechanisms.
create table info_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  lgu_id uuid not null references lgus(id),
  requested_by_role text not null check (requested_by_role in ('bplo_initial', 'department', 'treasury')),
  department text, -- only set when requested_by_role = 'department'
  notes text, -- nullable, matching the existing soft (UI-hinted, not enforced) notes requirement on department/initial-review decisions today
  requested_by uuid references staff_users(id),
  acted_on_behalf boolean not null default false, -- BPLO requesting on a department's/Treasury's behalf, same convention as department_reviews.acted_on_behalf
  requested_at timestamptz not null default now(),
  resolved_at timestamptz -- set once the applicant uploads a document and it's auto-routed back
);

-- The applicant status page and the upload-triggered resolve logic both
-- filter on "open requests for this application" constantly -- a partial
-- index on exactly that shape.
create index info_requests_open_idx on info_requests(application_id) where resolved_at is null;

alter table info_requests enable row level security;

-- SELECT: BPLO sees every request at their own LGU (rule #9 -- BPLO has
-- cross-department visibility everywhere else in this schema); a
-- department only sees its own; Treasury only sees its own. No UPDATE
-- policy -- resolution only ever happens via the applicant-facing
-- upload route's service-role client, matching how the rest of that
-- route already operates (no staff session involved in an applicant's
-- own upload).
create policy "bplo can view info requests at their own lgu"
  on info_requests for select
  using ((select current_staff.role from current_staff()) = 'bplo' and lgu_id = (select current_staff.lgu_id from current_staff()));

create policy "department can view their own info requests"
  on info_requests for select
  using (
    (select current_staff.role from current_staff()) = 'department'
    and lgu_id = (select current_staff.lgu_id from current_staff())
    and department = (select current_staff.department from current_staff())
  );

create policy "treasury can view their own info requests"
  on info_requests for select
  using (
    (select current_staff.role from current_staff()) = 'treasury'
    and lgu_id = (select current_staff.lgu_id from current_staff())
    and requested_by_role = 'treasury'
  );

-- INSERT: BPLO can create any type at their own LGU (their own initial-
-- review requests, plus acting on a department's or Treasury's behalf --
-- the same "widen, don't replace" pattern as payments-on-behalf,
-- migration 0030). A department can only create its own; Treasury can
-- only create its own.
create policy "bplo can create info requests at their own lgu"
  on info_requests for insert
  with check ((select current_staff.role from current_staff()) = 'bplo' and lgu_id = (select current_staff.lgu_id from current_staff()));

create policy "department can create their own info requests"
  on info_requests for insert
  with check (
    (select current_staff.role from current_staff()) = 'department'
    and lgu_id = (select current_staff.lgu_id from current_staff())
    and requested_by_role = 'department'
    and department = (select current_staff.department from current_staff())
  );

create policy "treasury can create their own info requests"
  on info_requests for insert
  with check (
    (select current_staff.role from current_staff()) = 'treasury'
    and lgu_id = (select current_staff.lgu_id from current_staff())
    and requested_by_role = 'treasury'
  );
