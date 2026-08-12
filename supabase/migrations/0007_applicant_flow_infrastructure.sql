-- Infrastructure for the applicant OTP flow + application submission
-- (build order step 5). Several small, justified additions discovered
-- while wiring this up -- none change the shape of anything already built.

-- ============================================================
-- 1. Applicant sessions
-- ============================================================
-- Applicants never get a Supabase Auth session (CLAUDE.md section 4) --
-- after OTP verification, we need our own lightweight session so
-- subsequent requests (submit application, upload documents) can prove
-- who they are without re-verifying the OTP every time. An opaque token
-- in an httpOnly cookie, looked up here server-side, rather than a JWT --
-- keeps this revocable (just delete the row) and auditable, and needs no
-- new library. Every route touching this table uses the service role key
-- (bypasses RLS by design, same as owners/otp_codes) -- enabling RLS with
-- zero policies below is the deny-by-default backstop, not the real
-- enforcement, exactly like migration 0002's pattern for owners/otp_codes.

create table applicant_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references owners(id) not null,
  session_token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

alter table applicant_sessions enable row level security;

-- ============================================================
-- 2. Human-readable application reference numbers
-- ============================================================
-- The applicant flow prototype shows a reference like "MS-2026-00482" on
-- the submitted/status screens. `applications.id` (uuid) isn't something
-- an applicant can read over the phone to BPLO, so this adds a short,
-- LGU-scoped, year-scoped sequential reference instead.
--
-- The "MS" prefix is San Miguel-specific -- per rule #1's spirit (nothing
-- LGU-specific hardcoded), it lives in a new lgus.short_code column, not
-- in application code, so onboarding LGU #2 is still just new rows.
--
-- Counter kept in its own table with an atomic upsert (ON CONFLICT DO
-- UPDATE is a single atomic operation in Postgres) rather than a
-- count(*)-based approach, to avoid two simultaneous submissions racing
-- to the same reference number.

alter table lgus add column short_code text;
update lgus set short_code = 'MS' where name = 'San Miguel';

alter table applications add column reference_number text unique;

create table application_reference_counters (
  lgu_id uuid references lgus(id) not null,
  year integer not null,
  last_number integer not null default 0,
  primary key (lgu_id, year)
);

alter table application_reference_counters enable row level security;

create or replace function generate_application_reference(p_lgu_id uuid, p_year integer)
returns text as $$
declare
  v_short_code text;
  v_next integer;
begin
  select coalesce(short_code, 'APP') into v_short_code from lgus where id = p_lgu_id;

  insert into application_reference_counters (lgu_id, year, last_number)
  values (p_lgu_id, p_year, 1)
  on conflict (lgu_id, year)
    do update set last_number = application_reference_counters.last_number + 1
  returning last_number into v_next;

  return v_short_code || '-' || p_year || '-' || lpad(v_next::text, 5, '0');
end;
$$ language plpgsql security definer set search_path = public;

-- ============================================================
-- 3. Storage bucket for application documents
-- ============================================================
-- Private bucket -- uploads and signed-URL reads both go through
-- service-role server code (upload: applicant's API route; read: staff
-- dashboards, once building those out), never direct anon/authenticated
-- client access, consistent with the same trust-boundary split as the
-- rest of the applicant-facing surface.

insert into storage.buckets (id, name, public)
values ('application-documents', 'application-documents', false)
on conflict (id) do nothing;
