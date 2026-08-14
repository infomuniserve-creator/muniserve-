-- Makes the applicant form's barangay list and nature-of-business options
-- per-LGU instead of hardcoded to San Miguel (src/lib/san-miguel-form-
-- options.ts) -- CLAUDE.md 7o follow-up, 2026-08-14. Flagged as a gap
-- back in 7n ("if MuniServe ever needs a second LGU with its own
-- picklists, this is the file to turn into a per-LGU lookup") -- this is
-- that pass, now that a real second client is actually being onboarded.
--
-- One table for both option types (not two tables) since the shape is
-- identical and this may grow to cover other per-LGU picklists later
-- without another migration.
create table lgu_form_options (
  id uuid primary key default gen_random_uuid(),
  lgu_id uuid references lgus(id) on delete cascade not null,
  option_type text not null check (option_type in ('barangay', 'nature_of_business')),
  value text not null,
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  unique (lgu_id, option_type, value)
);

alter table lgu_form_options enable row level security;

-- Public reference data for a pre-auth page (apply/page.tsx), read via
-- the service-role client exactly like resolveLguDisplay() already does
-- for lgus itself -- that bypasses RLS entirely, so this policy exists
-- only so a platform admin's own RLS-scoped session (createLguClient,
-- when a client's barangay list is set at onboarding) can write here.
-- Same shape as migration 0018's other "platform admins manage X" policies.
create policy "platform admins manage lgu form options"
on lgu_form_options for all
using (exists (select 1 from platform_admins where auth_user_id = auth.uid() and is_active = true))
with check (exists (select 1 from platform_admins where auth_user_id = auth.uid() and is_active = true));
