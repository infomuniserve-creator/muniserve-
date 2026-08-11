-- Add new_business_rate to fee_rules
--
-- Discovered on 2026-08-11 by reading the actual scanned San Miguel Revenue
-- Code (reference/revenue-code-scans/), page 23, "Special Provisions":
-- "Newly Operated Business -- In case of newly started business under
-- section 5, (a), (b), (c), (d), (e), (f), (g), (h) and (i)... the tax shall
-- be one percent (1%) of the capital investment, but in no case shall it be
-- less than the minimum provided by the pertinent schedule."
--
-- This is NOT what MUNISERVE_FeeComputation_v1.2.js implements (and
-- therefore not what the already-seeded data encodes): v1.2 plugs
-- capital_investment into the exact same graduated bracket lookup a
-- renewal would use for gross_sales. The actual rule is a flat percentage
-- of capital investment with a floor, not a bracket lookup at all.
--
-- Scope per the ordinance text: subsections (a) through (i) of Section 5 --
-- i.e. every LBT schedule EXCEPT (j) Lessor, which the special provision's
-- own list of letters does not include.
--
-- The "floor" (the schedule's minimum) doesn't need its own column: it's
-- whatever this fee_rule's lowest-sort_order bracket's base_fee already is
-- (0 for the purely-percentage schedules, which is a no-op floor -- only
-- the three step-function schedules, Manufacturer/Wholesaler/Contractor,
-- have a real nonzero floor). For a fee_rule with no brackets at all (Bank,
-- which is flat_percentage with no bracket rows), the floor is implicitly 0.

alter table fee_rules
  add column new_business_rate numeric;

comment on column fee_rules.new_business_rate is
  'For LBT schedules only (Section 5(a)-(i), NOT (j) Lessor): when '
  'application_type = ''new'', LBT = GREATEST(new_business_rate * '
  'capital_investment, this rule''s lowest-sort_order bracket base_fee, '
  'or 0 if no brackets exist) -- NOT a lookup into the graduated bracket '
  'table the way a renewal uses gross_sales. Null means this rule uses the '
  'ordinary bracket/percentage computation for new applications too '
  '(currently only true for Lessor).';
