-- Add the fields the applicant form was missing against San Miguel's real,
-- currently-live intake form.
--
-- Discovered 2026-08-13: src/app/apply/page.tsx was built in build order
-- step 5 against reference/MuniServe_Applicant_Flow_Prototype.html, before
-- anyone had compared it to the LGU's actual production form
-- (https://links.muniserve.ph/widget/form/LLkWXPS7wlzQ5bjDUSxZ). That form's
-- exact field list and conditional show/hide logic were extracted this
-- session and saved to reference/official-application-form/ -- see that
-- folder's README.md for how, and for the full gap analysis against what
-- was already built. This migration adds the columns the gap analysis
-- found missing.
--
-- Everything durably describing the business (registration info, address,
-- premises, operations, employee counts, all 9 nature-of-business-
-- conditional fields) goes on `businesses` and gets pre-filled/overwritten
-- on renewal -- the same pattern already used for nature_of_business /
-- barangay / address. Only the genuinely per-submission financial figures
-- (capital investment for new, gross sales for renewal) stay inside
-- applications.form_inputs, per the existing fee_rules.basis_field
-- convention ("which application input drives this -- gross_sales,
-- capital_investment, employee_count, etc.").
--
-- Two of the columns below -- is_branch_office, is_aircon -- are not new
-- concepts: CLAUDE.md section 7a already documents fee_rules.applies_to's
-- 'key:variant' convention (e.g. 'commercial bank:branch') as depending on
-- is_branch_office/is_aircon. They were simply never captured by the
-- applicant form until now. Column names here match that spec exactly.
--
-- `businesses.address` and `businesses.lbt_category` are deliberately left
-- alone: `address` stays as a legacy fallback for rows that predate the
-- structured columns below (the UI prefers the structured fields and falls
-- back to `address` when they're null); `lbt_category` is no longer
-- something the applicant form asks for at all (the real form doesn't ask
-- it either -- that classification is BPLO's/the future fee engine's job,
-- per build order step 7), but the column and its existing readers stay put.

-- ============================================================
-- owners -- "Owner's Gender" belongs to the person, not the business
-- (one owner can have multiple businesses, rule #3).
-- ============================================================

alter table owners
  add column gender text;

-- ============================================================
-- applications -- the perjury / data-privacy declaration checkbox.
-- Recorded as an acceptance timestamp (not just a boolean) so there's an
-- audit trail of when the applicant affirmed it, matching the rest of the
-- schema's habit of timestamping decisions rather than just flagging them.
-- ============================================================

alter table applications
  add column declaration_accepted_at timestamptz;

-- ============================================================
-- businesses -- registration, structured address, and the full
-- "Business Operation" section from the real form.
-- ============================================================

alter table businesses
  add column business_tax_payment text,      -- Annual / Bi-Annually / Quarterly
  add column organization_type text,        -- Sole Proprietorship / Partnership / Corporation / Cooperative / Other
  add column registration_authority text,   -- DTI / SEC / CDA / Other
  add column registration_no text,
  add column tin text,
  add column tax_type text,                 -- VAT / NON-VAT
  add column trade_name text,               -- trade/franchise name, if any

  -- Structured main office address (businesses.barangay already existed;
  -- it's now validated against the real 48-barangay picklist at the
  -- application layer instead of accepted as free text).
  add column unit_street text,
  add column city_town text,
  add column province text,
  add column zip_code text,

  -- Business Operation section
  add column business_activity text[],      -- Main Office / Branch Office Only / Admin / Warehouse / Others (multi-select in the source form)
  add column delivery_vehicle_count text,    -- source form types this as free text, not a number
  add column operation_address_different boolean,
  add column operation_address text,
  add column business_area_sqm text,
  add column total_floor_area_sqm text,
  add column secondary_business_activity text,
  add column premises_ownership text,        -- Owned / Rented / Other
  add column tax_declaration_no text,        -- shown when Owned
  add column monthly_rent text,               -- shown when Rented/Other
  add column lessor_name text,
  add column lessor_contact_no text,
  add column lessor_address text,
  add column has_employees boolean,
  add column male_employee_count integer,
  add column female_employee_count integer,
  add column employees_residing_in_lgu_count integer,
  add column has_barangay_clearance text,    -- 'Yes' / 'No, generate my Brgy. clearance' -- kept as the raw picklist value, not a boolean, since the "No" option triggers a distinct real-world BPLO action
  add column has_tax_incentives boolean,

  -- Nature-of-business-conditional fields (9 groups in the real form; the
  -- previous build only captured 3 of them, matched by fuzzy substring on
  -- free text instead of the real ~200-option picklist).
  add column billiard_table_count integer,
  add column lodger_count integer,
  add column land_area_hectares numeric,
  add column guard_post_count integer,
  add column warehouse_floor_area_sqm numeric,
  add column seating_capacity integer,
  add column is_aircon boolean,
  add column is_branch_office boolean,
  add column animal_count integer;

-- ============================================================
-- businesses previously had no staff write policy at all -- only the
-- "staff can view businesses at their own lgu" select policy from
-- 0002_rls_policies.sql. Removing the applicant-facing LBT-category
-- dropdown (it doesn't exist in the real form -- see this migration's
-- header) leaves lbt_category with no path to ever get set for a new
-- application. As a stopgap until the fee engine (build order step 7) can
-- derive it automatically from nature_of_business, BPLO gets a manual
-- override control. Mirrors "bplo can update applications at their own
-- lgu" (0002_rls_policies.sql) exactly, one table over.
-- ============================================================

create policy "bplo can update businesses at their own lgu"
on businesses for update
using (
  lgu_id = (select lgu_id from current_staff())
  and (select role from current_staff()) = 'bplo'
);
