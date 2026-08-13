-- Permit History -- a read-only historical transaction log, one row per
-- permit issued or renewed per year, distinct from `applications`.
--
-- Discovered 2026-08-13 (continuing the same day's dashboard-redesign
-- session): the project owner shared a reference dashboard they'd built
-- against San Miguel's real historical records (2020-2026, 13,548 rows,
-- sourced from a GoHighLevel pipeline export) and asked for the same
-- design + data as a second "Permit History" view alongside the
-- card-based Business Registry (Directory).
--
-- This is deliberately its OWN table, not a backfill into `applications`:
-- these are raw historical facts about permits issued through whatever
-- process the LGU used before MuniServe existed, not MuniServe-mediated
-- workflow records (no review_rounds, no department_reviews, no
-- initial_review_* -- none of that ever happened for these). Forcing them
-- into `applications` would imply a review history that never occurred.
--
-- `business_id` is nullable and populated best-effort at import time by
-- matching `legacy_license_no` against the existing `businesses` table --
-- many of these 7 years of records predate or don't match anything
-- currently in `businesses` (which is a current-snapshot import, not a
-- historical one), so an unmatched row is expected, not an error.
--
-- Category/owner_type/pay_frequency/gender are free-standing text columns
-- rather than reusing businesses.lbt_category or the applicant-form
-- picklists (organization_type, business_tax_payment) -- this source
-- uses its own coarser taxonomy (4 categories vs. ~200 nature-of-business
-- values) and forcing a 1:1 mapping between two different classification
-- systems would misrepresent one or the other. Kept separate and honest.

create table permit_history (
  id uuid primary key default gen_random_uuid(),
  lgu_id uuid references lgus(id) on delete cascade not null,
  business_id uuid references businesses(id),
  year integer not null,
  permit_no text,
  business_name text not null,
  owner_name text,
  barangay text,
  application_type text check (application_type in ('new', 'renewal')),
  category text,
  description text,
  owner_type text,
  gender text check (gender in ('Male', 'Female')),
  amount_paid numeric,
  capital numeric,
  gross_sales numeric,
  pay_frequency text,
  legacy_license_no text,
  created_at timestamptz default now()
);

create index permit_history_lgu_id_idx on permit_history (lgu_id);
create index permit_history_lgu_id_year_idx on permit_history (lgu_id, year);
create index permit_history_legacy_license_no_idx on permit_history (legacy_license_no);

alter table permit_history enable row level security;

-- Read-only for every staff role at their own LGU -- same "any staff can
-- view" shape as businesses/applications (migration 0002). No staff
-- write policy: import is a one-time service-role operation
-- (supabase/seed/import_permit_history.mjs), not an app feature.
create policy "staff can view permit history at their own lgu"
on permit_history for select
using (lgu_id = (select lgu_id from current_staff()));
