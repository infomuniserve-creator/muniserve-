-- Add rate_basis to fee_rule_brackets
--
-- Discovered while translating MUNISERVE_FeeComputation_v1.2.js into seed data
-- (CLAUDE.md section 7). Most tiered/tiered_percentage schedules apply a
-- bracket's `rate` to the excess above `min_amount` (standard marginal-bracket
-- math) -- e.g. LBT Schedule G (Food & Beverage), Schedule D (Retailer).
--
-- But several schedules' open-ended top bracket applies the rate to the FULL
-- basis amount instead, not the excess -- e.g. LBT Schedule A (Manufacturer):
-- "6.5M and above -> sales * 0.00375" means sales * 0.00375 in full, not
-- 0.00375 * (sales - 6,500,000). Same pattern in Schedule B (Wholesaler) and
-- Schedule E (Contractor). Without an explicit flag, the fee computation
-- engine (build order step 6) has no way to know which behavior a given
-- bracket needs -- and per CLAUDE.md rule #1, that distinction has to live in
-- data, not get hardcoded as a per-schedule special case in application code.

alter table fee_rule_brackets
  add column rate_basis text not null default 'excess_over_min'
    check (rate_basis in ('excess_over_min', 'full_amount'));

comment on column fee_rule_brackets.rate_basis is
  'excess_over_min: fee = base_fee + rate * (basis - min_amount) [default, standard marginal bracket]. '
  'full_amount: fee = rate * basis [used by a handful of LBT schedules'' open-ended top bracket -- see 0003 migration comment].';
