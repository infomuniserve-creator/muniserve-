-- MuniServe initial schema
-- Source of truth: CLAUDE.md section 3. Do not change shape/relationships without
-- checking back against the non-negotiable rules in section 2.

-- ============================================================
-- LGU CONFIGURATION
-- ============================================================

create table lgus (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  province text,
  logo_url text,
  created_at timestamptz default now()
);

create table lgu_departments (
  id uuid primary key default gen_random_uuid(),
  lgu_id uuid references lgus(id) on delete cascade,
  name text not null,               -- e.g. 'Zoning', 'Fire', 'MENRO', 'Engineering'
  display_name text,
  is_active boolean default true,
  created_at timestamptz default now(),
  unique (lgu_id, name)
);

-- ============================================================
-- FEE RULE ENGINE — the whole point of this being data-driven
-- ============================================================

create table fee_rules (
  id uuid primary key default gen_random_uuid(),
  lgu_id uuid references lgus(id) on delete cascade,
  name text not null,                          -- e.g. "LBT Schedule A — Manufacturer"
  computation_type text not null check (computation_type in (
    'flat', 'per_unit', 'tiered', 'flat_percentage', 'tiered_percentage',
    'formula_increment', 'discount_subset', 'discount_percentage', 'time_surcharge'
  )),
  applies_to text,                             -- lbt_category, business type, or 'all'
  basis_field text,                            -- which application input drives this (gross_sales, capital_investment, employee_count, etc.)
  flat_amount numeric,
  per_unit_rate numeric,
  per_unit_field text,                         -- e.g. 'employee_count', 'signboard_sqm'
  percentage_rate numeric,
  formula_base_fee numeric,                    -- CEDULA-style: base + increment per bracket
  formula_increment_amount numeric,
  formula_increment_per numeric,
  formula_cap numeric,
  discount_target_fee_rule_ids uuid[],         -- for discount_subset: which fee_rules this discount reduces
  surcharge_base_rate numeric,
  surcharge_monthly_rate numeric,
  surcharge_cap_months integer,                -- RA 7160 Sec. 168 caps this at 36 — verify per LGU
  delivery_mode text not null default 'online' check (delivery_mode in ('online', 'reference_only', 'external')),
  is_active boolean default true,
  sort_order integer default 0,
  created_at timestamptz default now()
);

create table fee_rule_brackets (
  id uuid primary key default gen_random_uuid(),
  fee_rule_id uuid references fee_rules(id) on delete cascade,
  min_amount numeric not null,
  max_amount numeric,                          -- null = no upper bound
  base_fee numeric default 0,
  rate numeric default 0,                      -- applied to the excess above min_amount
  sort_order integer not null
);

-- ============================================================
-- IDENTITY — passwordless, phone-first
-- ============================================================

create table owners (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text unique,
  email text,
  claimed_at timestamptz,
  merged_into_owner_id uuid references owners(id),
  created_at timestamptz default now()
);

create table otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone_or_email text not null,
  code text not null,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz default now()
);

create table staff_users (
  id uuid primary key default gen_random_uuid(),
  lgu_id uuid references lgus(id) on delete cascade,
  auth_user_id uuid references auth.users(id),
  full_name text,
  email text,
  role text not null check (role in ('bplo', 'treasury', 'mayor', 'department')),
  department text,                             -- only set when role = 'department'; must match lgu_departments.name
  is_active boolean default true,
  created_at timestamptz default now()
);

-- ============================================================
-- BUSINESSES & APPLICATIONS
-- ============================================================

create table businesses (
  id uuid primary key default gen_random_uuid(),
  lgu_id uuid references lgus(id) on delete cascade,
  owner_id uuid references owners(id),         -- nullable until a legacy record is claimed
  business_name text not null,
  barangay text,
  address text,
  nature_of_business text,
  lbt_category text,
  legacy_license_no text unique,               -- bridge key for pre-existing LGU records
  is_legacy_unclaimed boolean default false,
  gross_sales_history jsonb,                   -- { "2024": 123456, "2025": 134000 }
  is_active boolean default true,
  created_at timestamptz default now()
);

create table applications (
  id uuid primary key default gen_random_uuid(),
  lgu_id uuid references lgus(id) on delete cascade,
  business_id uuid references businesses(id),
  application_type text not null check (application_type in ('new', 'renewal')),
  application_year integer,
  status text not null default 'submitted' check (status in (
    'submitted', 'pending_bplo_initial', 'pending_dept_review', 'returned_to_applicant',
    'pending_bplo_assessment', 'pending_payment', 'pending_mayor', 'released', 'rejected'
  )),
  form_inputs jsonb,
  submitted_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table application_fee_lines (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references applications(id) on delete cascade,
  fee_rule_id uuid references fee_rules(id),
  computed_amount numeric not null,
  overridden_amount numeric,
  override_reason text,
  overridden_by uuid references staff_users(id),
  overridden_at timestamptz,
  included_in_total boolean default true,
  created_at timestamptz default now()
);

-- ============================================================
-- REVIEW WORKFLOW — parallel fan-out, round-scoped
-- ============================================================

create table review_rounds (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references applications(id) on delete cascade,
  round_number integer not null,
  opened_at timestamptz default now()
);

create table department_reviews (
  id uuid primary key default gen_random_uuid(),
  review_round_id uuid references review_rounds(id) on delete cascade,
  department text not null,
  reviewer_id uuid references staff_users(id),
  acted_on_behalf boolean default false,        -- true when BPLO submitted this decision as a proxy
  decision text not null default 'pending' check (decision in (
    'pending', 'approved', 'approved_with_condition', 'request_more_info', 'rejected'
  )),
  notes text,
  reviewed_at timestamptz,
  reminder_sent_at timestamptz,
  escalated_at timestamptz,
  created_at timestamptz default now()
);

-- ============================================================
-- PAYMENT, PERMITS, DOCUMENTS, NOTIFICATIONS
-- ============================================================

create table payments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references applications(id),
  amount numeric not null,
  method text,
  or_number text,
  received_by uuid references staff_users(id),
  received_at timestamptz default now()
);

create table permits (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references applications(id),
  permit_number text unique,
  issued_at timestamptz,
  valid_until date,
  pdf_url text,
  qr_code_url text
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references applications(id),
  document_type text,
  file_url text,
  uploaded_at timestamptz default now()
);

create table notifications_log (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references applications(id),
  channel text check (channel in ('sms', 'email')),
  recipient text,
  message text,
  status text,
  sent_at timestamptz default now()
);
