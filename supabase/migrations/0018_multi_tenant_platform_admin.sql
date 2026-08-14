-- Multi-tenant onboarding (CLAUDE.md section 7o): subdomain-based LGU
-- routing + a platform-admin role that sits above the LGU-scoped staff
-- roles (bplo/treasury/mayor/department), so a new client LGU can be
-- onboarded through a UI instead of needing direct database access
-- every time (the same gap 7m closed for staff, one level up).

-- Each LGU gets its own subdomain (e.g. 'sanmiguel' -> sanmiguel.muniserve.ph)
-- so the applicant-facing pages know whose branding/data to show before
-- anyone has signed in. San Miguel keeps working exactly as today at
-- portal.muniserve.ph (a reserved, non-LGU subdomain) -- this only
-- matters for *new* LGUs that get their own dedicated subdomain.
alter table lgus add column subdomain text unique;
update lgus set subdomain = 'sanmiguel' where name = 'San Miguel';

-- Deliberately a separate table, not a nullable lgu_id on staff_users:
-- a platform admin isn't scoped to any single LGU (they work across all
-- of them), and every existing RLS policy + application assumption
-- already treats staff.lgu_id as always-present. Mixing the two would
-- mean auditing every one of those for a null case instead of just
-- adding a clean second door.
create table platform_admins (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id),
  email text unique not null,
  full_name text,
  is_active boolean default true,
  created_at timestamptz default now()
);
alter table platform_admins enable row level security;

create policy "platform admin can view own row"
on platform_admins for select
using (auth_user_id = auth.uid());

-- Additive to every existing lgus/lgu_departments/staff_users policy --
-- these give platform admins a second, broader path in; staff's own
-- narrower per-LGU policies (migration 0002, 0009, 0015) are untouched.
create policy "platform admins manage lgus"
on lgus for all
using (exists (select 1 from platform_admins where auth_user_id = auth.uid() and is_active = true))
with check (exists (select 1 from platform_admins where auth_user_id = auth.uid() and is_active = true));

create policy "platform admins manage lgu departments"
on lgu_departments for all
using (exists (select 1 from platform_admins where auth_user_id = auth.uid() and is_active = true))
with check (exists (select 1 from platform_admins where auth_user_id = auth.uid() and is_active = true));

create policy "platform admins manage staff_users"
on staff_users for all
using (exists (select 1 from platform_admins where auth_user_id = auth.uid() and is_active = true))
with check (exists (select 1 from platform_admins where auth_user_id = auth.uid() and is_active = true));

-- Bootstrap: nobody can self-elevate to platform admin, so the very
-- first row has to be seeded directly, same as San Miguel's first BPLO
-- account was. auth_user_id stays null and self-links on next sign-in
-- via the same claim-by-email mechanism as staff (auth/callback/route.ts).
insert into platform_admins (email, full_name)
values ('benj@getmorestudents.com', 'Benj Maglente')
on conflict (email) do nothing;
