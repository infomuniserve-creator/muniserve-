-- ============================================================
-- SAN MIGUEL, BULACAN -- fee_rules / fee_rule_brackets seed data
-- ============================================================
-- Source: reference/MUNISERVE_FeeComputation_v1.2.js (treated as the
-- confirmed baseline -- it's what the old GHL system actually charged).
-- Cross-checked against reference/MuniServe_FeeComputation_ChatGPT_Prompt.md
-- (v2.0) and reference/MUNISERVE_DOC_CEDULA_Calculation.html per CLAUDE.md
-- section 7. Discrepancies between v1.2 and v2.0 were resolved with the
-- project owner on 2026-08-11 -- see CLAUDE.md section 7 for the record.
--
-- Safe to re-run: deletes and reinserts San Miguel's fee_rules before
-- seeding (fee_rule_brackets cascade-delete with their parent).
--
-- Requires migration 0003 (fee_rule_brackets.rate_basis) to already be applied.
--
-- ── Conventions used below (not yet formalized in CLAUDE.md -- see the
--    seed script's closing NOTE FOR CLAUDE.md section) ──
-- 1. basis_field = 'lbt_basis' for every LBT schedule: a computed value the
--    fee engine derives per CLAUDE.md section 5's rule -- capital_investment
--    if application_type = 'new', gross_sales (preceding year) if 'renewal'.
--    Not a literal column on `applications`.
-- 2. fee_rule_brackets.max_amount is EXCLUSIVE (matches the source tables'
--    "less than X" language) *except* where a comment says otherwise for a
--    specific bracket (a couple of the source's flat-tier boundaries are
--    genuinely inclusive of the upper value; those rows use max = X + 0.01
--    as an exclusive-max-compatible stand-in, since these are 2-decimal
--    peso amounts).
-- 3. rate_basis = 'full_amount' marks the handful of open-ended top brackets
--    (Manufacturer, Wholesaler, Contractor) where the source multiplies the
--    FULL basis by the rate, not the excess over min_amount. See migration
--    0003 for why this column exists.
-- 4. For Mayor's Permit rows that depend on is_branch_office or is_aircon
--    (bank/finance-company principal-vs-branch, cinema aircon-vs-non), two
--    separate rows exist with a '_branch'/'_principal' or
--    '_aircon'/'_nonaircon' suffix on applies_to. The fee engine (build
--    order step 6) must pick the right row using that boolean input, not
--    just nature_of_business.
-- 5. For the two Mayor's Permit "standard" (non-special-type) fallback
--    rules, applies_to holds 'standard:new' / 'standard:renewal' -- these
--    are selected by application_type when no special-type row matches,
--    not by nature_of_business.
-- 6. Essential-commodity discount eligibility (applies_to on the discount
--    row) is a '|'-pipe-separated list of nature_of_business values, since
--    fee_rules.applies_to is a single text column, not an array. The fee
--    engine must split on '|' to check membership.
-- 7. KNOWN ANOMALY, not fixed here: v1.2's Food & Beverage / Amusement /
--    Other schedules have a ~PHP 25 discontinuity at exactly
--    receipts = 100,000 (the "<=100,000" bracket's formula evaluates higher
--    than the next bracket's base_fee at that exact boundary). This looks
--    like a transcription slip in the legacy code, not an intentional rule.
--    Seeded here as a clean continuous marginal bracket (matching every
--    other boundary in the same schedules, which ARE continuous) rather
--    than preserving a probable bug at one single exact peso value.
--    Flag for BPLO if this ever gets audited against the original ordinance.

-- ============================================================
-- 0. LGU
-- ============================================================

insert into lgus (name, province)
select 'San Miguel', 'Bulacan'
where not exists (select 1 from lgus where name = 'San Miguel');

-- Idempotency: clear out any previously-seeded San Miguel fee rules
-- (fee_rule_brackets cascade with their parent fee_rules row).
delete from fee_rules where lgu_id = (select id from lgus where name = 'San Miguel');

-- ============================================================
-- 1. LBT SCHEDULE A -- Manufacturer / Assembler / Repackager / Processor
--    Source: v1.2 lbtManufacturer() / v2.0 Schedule A
-- ============================================================

with fr as (
  insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, delivery_mode, sort_order)
  select (select id from lgus where name = 'San Miguel'),
         'LBT Schedule A -- Manufacturer / Assembler / Repackager / Processor / Brewer / Distiller / Rectifier / Compounder',
         'tiered', 'manufacturer', 'lbt_basis', 'online', 10
  returning id
)
insert into fee_rule_brackets (fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order)
select fr.id, v.min_amount, v.max_amount, v.base_fee, v.rate, v.rate_basis, v.sort_order
from fr, (values
  (0::numeric,       10000::numeric,   165::numeric, 0::numeric, 'excess_over_min', 1),
  (10000,      15000,     220, 0, 'excess_over_min', 2),
  (15000,      20000,     302, 0, 'excess_over_min', 3),
  (20000,      30000,     440, 0, 'excess_over_min', 4),
  (30000,      40000,     660, 0, 'excess_over_min', 5),
  (40000,      50000,     825, 0, 'excess_over_min', 6),
  (50000,      75000,    1320, 0, 'excess_over_min', 7),
  (75000,     100000,    1650, 0, 'excess_over_min', 8),
  (100000,    150000,    2200, 0, 'excess_over_min', 9),
  (150000,    200000,    2750, 0, 'excess_over_min', 10),
  (200000,    300000,    3850, 0, 'excess_over_min', 11),
  (300000,    500000,    5500, 0, 'excess_over_min', 12),
  (500000,    750000,    8000, 0, 'excess_over_min', 13),
  (750000,   1000000,   10000, 0, 'excess_over_min', 14),
  (1000000,  2000000,   13750, 0, 'excess_over_min', 15),
  (2000000,  3000000,   16500, 0, 'excess_over_min', 16),
  (3000000,  4000000,   19800, 0, 'excess_over_min', 17),
  (4000000,  5000000,   23100, 0, 'excess_over_min', 18),
  (5000000,  6500000,   24375, 0, 'excess_over_min', 19),
  (6500000,  null,          0, 0.00375, 'full_amount', 20)
) as v(min_amount, max_amount, base_fee, rate, rate_basis, sort_order);

-- ============================================================
-- 2. LBT SCHEDULE B -- Wholesaler / Importer / Distributor / Dealer
--    Source: v1.2 lbtWholesaler() / v2.0 Schedule B
-- ============================================================

with fr as (
  insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, delivery_mode, sort_order)
  select (select id from lgus where name = 'San Miguel'),
         'LBT Schedule B -- Wholesaler / Importer / Distributor / Dealer',
         'tiered', 'wholesaler', 'lbt_basis', 'online', 20
  returning id
)
insert into fee_rule_brackets (fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order)
select fr.id, v.min_amount, v.max_amount, v.base_fee, v.rate, v.rate_basis, v.sort_order
from fr, (values
  (0::numeric,   1000::numeric,   18::numeric, 0::numeric, 'excess_over_min', 1),
  (1000,    2000,    33, 0, 'excess_over_min', 2),
  (2000,    3000,    50, 0, 'excess_over_min', 3),
  (3000,    4000,    72, 0, 'excess_over_min', 4),
  (4000,    5000,   100, 0, 'excess_over_min', 5),
  (5000,    6000,   121, 0, 'excess_over_min', 6),
  (6000,    7000,   143, 0, 'excess_over_min', 7),
  (7000,    8000,   165, 0, 'excess_over_min', 8),
  (8000,   10000,   187, 0, 'excess_over_min', 9),
  (10000,  15000,   220, 0, 'excess_over_min', 10),
  (15000,  20000,   275, 0, 'excess_over_min', 11),
  (20000,  30000,   330, 0, 'excess_over_min', 12),
  (30000,  40000,   440, 0, 'excess_over_min', 13),
  (40000,  50000,   660, 0, 'excess_over_min', 14),
  (50000,  75000,   990, 0, 'excess_over_min', 15),
  (75000, 100000,  1320, 0, 'excess_over_min', 16),
  (100000,150000,  1870, 0, 'excess_over_min', 17),
  (150000,200000,  2420, 0, 'excess_over_min', 18),
  (200000,300000,  3300, 0, 'excess_over_min', 19),
  (300000,500000,  4400, 0, 'excess_over_min', 20),
  (500000,750000,  6600, 0, 'excess_over_min', 21),
  (750000,1000000, 8000, 0, 'excess_over_min', 22),
  (1000000,2000000,10000, 0, 'excess_over_min', 23),
  (2000000,null,       0, 0.005, 'full_amount', 24)
) as v(min_amount, max_amount, base_fee, rate, rate_basis, sort_order);

-- ============================================================
-- 3. LBT SCHEDULE D -- Retailer
--    Source: v1.2 lbtRetailer() / v2.0 Schedule D
--    Clean 2-bracket marginal schedule -- no anomalies.
-- ============================================================

with fr as (
  insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, delivery_mode, sort_order)
  select (select id from lgus where name = 'San Miguel'),
         'LBT Schedule D -- Retailer', 'tiered_percentage', 'retailer', 'lbt_basis', 'online', 30
  returning id
)
insert into fee_rule_brackets (fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order)
select fr.id, v.min_amount, v.max_amount, v.base_fee, v.rate, v.rate_basis, v.sort_order
from fr, (values
  (0::numeric,     400000::numeric, 0::numeric,    0.02::numeric, 'excess_over_min', 1),
  (400000, null,             8000,          0.01,          'excess_over_min', 2)
) as v(min_amount, max_amount, base_fee, rate, rate_basis, sort_order);

-- ============================================================
-- 4. LBT SCHEDULE E -- Contractor / Independent Contractor
--    Source: v1.2 lbtContractor() / v2.0 Schedule E
--    NOTE: source has a real (and odd) drop from 11,000 (at 1M-2M) to
--    2,000,000 * 0.005 = 10,000 right at the 2M threshold -- i.e. the fee
--    goes DOWN as receipts cross 2M. Preserved faithfully; flag for BPLO.
-- ============================================================

with fr as (
  insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, delivery_mode, sort_order)
  select (select id from lgus where name = 'San Miguel'),
         'LBT Schedule E -- Contractor / Independent Contractor',
         'tiered', 'contractor', 'lbt_basis', 'online', 40
  returning id
)
insert into fee_rule_brackets (fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order)
select fr.id, v.min_amount, v.max_amount, v.base_fee, v.rate, v.rate_basis, v.sort_order
from fr, (values
  (0::numeric,      5000::numeric,   27.50::numeric, 0::numeric, 'excess_over_min', 1),
  (5000,      10000,     61.60, 0, 'excess_over_min', 2),
  (10000,     15000,    104.50, 0, 'excess_over_min', 3),
  (15000,     20000,       165, 0, 'excess_over_min', 4),
  (20000,     30000,       275, 0, 'excess_over_min', 5),
  (30000,     40000,       385, 0, 'excess_over_min', 6),
  (40000,     50000,       550, 0, 'excess_over_min', 7),
  (50000,     75000,       880, 0, 'excess_over_min', 8),
  (75000,    100000,      1320, 0, 'excess_over_min', 9),
  (100000,   150000,      1980, 0, 'excess_over_min', 10),
  (150000,   200000,      2640, 0, 'excess_over_min', 11),
  (200000,   250000,      3630, 0, 'excess_over_min', 12),
  (250000,   300000,      4620, 0, 'excess_over_min', 13),
  (300000,   400000,      6160, 0, 'excess_over_min', 14),
  (400000,   500000,      8250, 0, 'excess_over_min', 15),
  (500000,   750000,      9250, 0, 'excess_over_min', 16),
  (750000,  1000000,     10250, 0, 'excess_over_min', 17),
  (1000000, 2000000,     11000, 0, 'excess_over_min', 18),
  (2000000, null,            0, 0.005, 'full_amount', 19)
) as v(min_amount, max_amount, base_fee, rate, rate_basis, sort_order);

-- ============================================================
-- 5. LBT SCHEDULE F -- Bank / Financial Institution
--    Source: v1.2 lbtBank() / v2.0 Schedule F. Flat percentage -- no brackets.
-- ============================================================

insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, percentage_rate, delivery_mode, sort_order)
select (select id from lgus where name = 'San Miguel'),
       'LBT Schedule F -- Bank / Financial Institution',
       'flat_percentage', 'bank_financial', 'lbt_basis', 0.005, 'online', 50;

-- ============================================================
-- 6. LBT SCHEDULE G -- Food & Beverage Establishment
--    Source: v1.2 lbtFoodBeverage() / v2.0 Schedule G
--    See file header note 7 re: the ~PHP25 anomaly at receipts=100,000 --
--    seeded here as continuous (matches every other boundary in this table).
-- ============================================================

with fr as (
  insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, delivery_mode, sort_order)
  select (select id from lgus where name = 'San Miguel'),
         'LBT Schedule G -- Food & Beverage Establishment',
         'tiered_percentage', 'food_beverage', 'lbt_basis', 'online', 60
  returning id
)
insert into fee_rule_brackets (fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order)
select fr.id, v.min_amount, v.max_amount, v.base_fee, v.rate, v.rate_basis, v.sort_order
from fr, (values
  (0::numeric,      20000::numeric,    0::numeric, 0.0025::numeric, 'excess_over_min', 1),
  (20000,     50000,     50,   0.005,  'excess_over_min', 2),
  (50000,    100000,    200,   0.0075, 'excess_over_min', 3),
  (100000,   200000,    550,   0.01,   'excess_over_min', 4),
  (200000,   500000,   1550,   0.0125, 'excess_over_min', 5),
  (500000,   750000,   5300,   0.015,  'excess_over_min', 6),
  (750000,  1000000,   9050,   0.0175, 'excess_over_min', 7),
  (1000000, null,     13425,   0.02,   'excess_over_min', 8)
) as v(min_amount, max_amount, base_fee, rate, rate_basis, sort_order);

-- ============================================================
-- 7. LBT SCHEDULE H -- Amusement / Recreational Place
--    Source: v1.2 lbtAmusement() / v2.0 Schedule H
--    Same shape as G except the first bracket's rate (0.0125 vs 0.0025) and
--    the top bracket's base_fee (23,425 vs 13,425) -- both intentional per
--    source, not a copy-paste error.
-- ============================================================

with fr as (
  insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, delivery_mode, sort_order)
  select (select id from lgus where name = 'San Miguel'),
         'LBT Schedule H -- Amusement / Recreational Place',
         'tiered_percentage', 'amusement', 'lbt_basis', 'online', 70
  returning id
)
insert into fee_rule_brackets (fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order)
select fr.id, v.min_amount, v.max_amount, v.base_fee, v.rate, v.rate_basis, v.sort_order
from fr, (values
  (0::numeric,      20000::numeric,    0::numeric, 0.0125::numeric, 'excess_over_min', 1),
  (20000,     50000,     50,   0.005,  'excess_over_min', 2),
  (50000,    100000,    200,   0.0075, 'excess_over_min', 3),
  (100000,   200000,    550,   0.01,   'excess_over_min', 4),
  (200000,   500000,   1550,   0.0125, 'excess_over_min', 5),
  (500000,   750000,   5300,   0.015,  'excess_over_min', 6),
  (750000,  1000000,   9050,   0.0175, 'excess_over_min', 7),
  (1000000, null,     23425,   0.02,   'excess_over_min', 8)
) as v(min_amount, max_amount, base_fee, rate, rate_basis, sort_order);

-- ============================================================
-- 8. LBT SCHEDULE I -- All Other Businesses (default/catch-all LBT category)
--    Source: v1.2 lbtOther() / v2.0 Schedule I. applies_to = 'all' so this
--    is the fallback when lbt_category doesn't match any named schedule
--    (mirrors v1.2's if/else-if chain ending in an unconditional `else`).
-- ============================================================

with fr as (
  insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, delivery_mode, sort_order)
  select (select id from lgus where name = 'San Miguel'),
         'LBT Schedule I -- All Other Businesses (default)',
         'tiered_percentage', 'all', 'lbt_basis', 'online', 80
  returning id
)
insert into fee_rule_brackets (fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order)
select fr.id, v.min_amount, v.max_amount, v.base_fee, v.rate, v.rate_basis, v.sort_order
from fr, (values
  -- first two rows jointly reproduce v1.2's `max(5, receipts * 0.0025)` --
  -- both formulas agree exactly at receipts = 2000, so the split is exact.
  (0::numeric,       2000::numeric,    5::numeric, 0::numeric,      'excess_over_min', 1),
  (2000,       20000,      0,   0.0025, 'full_amount',     2),
  (20000,      50000,     50,   0.005,  'excess_over_min', 3),
  (50000,     100000,    200,   0.0075, 'excess_over_min', 4),
  (100000,    200000,    550,   0.01,   'excess_over_min', 5),
  (200000,    500000,   1550,   0.0125, 'excess_over_min', 6),
  (500000,    750000,   5300,   0.015,  'excess_over_min', 7),
  (750000,   1000000,   9050,   0.0175, 'excess_over_min', 8),
  (1000000,  null,     13425,   0.02,   'excess_over_min', 9)
) as v(min_amount, max_amount, base_fee, rate, rate_basis, sort_order);

-- ============================================================
-- 9. LBT SCHEDULE J -- Lessor / Sublessor of Real Property
--    Source: v1.2 lbtLessor() / v2.0 Schedule J. Flat percentage -- no brackets.
-- ============================================================

insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, percentage_rate, delivery_mode, sort_order)
select (select id from lgus where name = 'San Miguel'),
       'LBT Schedule J -- Lessor / Sublessor of Real Property',
       'flat_percentage', 'lessor', 'lbt_basis', 0.015, 'online', 90;

-- ============================================================
-- 10. ESSENTIAL COMMODITY DISCOUNT (RA 7160 Sec. 143(c) / 5-c)
--     Source: v1.2 ESSENTIAL_COMMODITY_TYPES list. 50% off LBT, only for
--     manufacturer/wholesaler/retailer categories (v1.2's essentialEligible
--     check) -- v2.0's broader commodity-category framing was NOT used here
--     since v1.2 is the confirmed baseline; revisit if San Miguel confirms
--     the wider v2.0 list should apply.
-- ============================================================

insert into fee_rules (
  lgu_id, name, computation_type, applies_to, percentage_rate,
  discount_target_fee_rule_ids, delivery_mode, sort_order
)
select
  (select id from lgus where name = 'San Miguel'),
  'Essential Commodity Discount (50% off LBT)',
  'discount_subset',
  'rice dealer|rice retailer|rice mill|rice and corn dealer|meat shop|fish dealer|fish/seafood dealer|fish/seafood stall|seafood dealer|vegetable stall|fruit stall|vegetable/fruit stall|fruit and vegetable stand|pharmacy|drugstore|drug store|school supplies store|sari-sari store|grocery store|grocery|general merchandise|feed store|agricultural supply store|agri-vet supply|poultry and livestock supply|cooking oil retailer|salt dealer|bread retailer|bakery',
  0.5,
  array(
    select id from fee_rules
    where lgu_id = (select id from lgus where name = 'San Miguel')
      and applies_to in ('manufacturer', 'wholesaler', 'retailer')
  ),
  'online', 100;

-- ============================================================
-- 11. CEDULA (Community Tax Certificate) -- RA 7160 Sec. 156-162
--     Source: reference/MUNISERVE_DOC_CEDULA_Calculation.html.
--     National-law-based, not an LGU-set rate, but seeded per-LGU to match
--     the schema's scoping (every LGU gets the same two rows).
--     Cooperatives seeded as juridical (same formula as Corp/Partnership,
--     NOT exempt) per the project owner's resolution of the doc's internal
--     Section 7 vs Section 9 contradiction -- see CLAUDE.md section 7.
--     delivery_mode = 'reference_only': CEDULA is computed here but must
--     still be secured/paid at the Treasurer's Office per CLAUDE.md rule #11.
-- ============================================================

insert into fee_rules (
  lgu_id, name, computation_type, applies_to, basis_field,
  formula_base_fee, formula_increment_amount, formula_increment_per, formula_cap,
  delivery_mode, sort_order
)
select (select id from lgus where name = 'San Miguel'),
       'CEDULA -- Individual (Sole Proprietorship)',
       'formula_increment', 'individual', 'lbt_basis',
       5.00, 1.00, 1000, 5005.00,
       'reference_only', 110
union all
select (select id from lgus where name = 'San Miguel'),
       'CEDULA -- Juridical (Corporation / Partnership / Cooperative)',
       'formula_increment', 'juridical', 'lbt_basis',
       500.00, 2.00, 5000, 10500.00,
       'reference_only', 111;

-- ============================================================
-- 12. APPLICATION FEE -- Section 4.03, flat PHP 10 per application
-- ============================================================

insert into fee_rules (lgu_id, name, computation_type, applies_to, flat_amount, delivery_mode, sort_order)
select (select id from lgus where name = 'San Miguel'),
       'Application Fee', 'flat', 'all', 10.00, 'online', 120;

-- ============================================================
-- 13. MAYOR'S PERMIT -- standard fallback (no special business type matched)
--     Source: v1.2's else-branch in the main script (Section 4.01).
--     See file header note 5 re: applies_to = 'standard:new' / 'standard:renewal'.
-- ============================================================

insert into fee_rules (lgu_id, name, computation_type, applies_to, flat_amount, delivery_mode, sort_order)
select (select id from lgus where name = 'San Miguel'),
       'Mayor''s Permit -- Standard (New Application)', 'flat', 'standard:new', 500.00, 'online', 200;

with fr as (
  insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, delivery_mode, sort_order)
  select (select id from lgus where name = 'San Miguel'),
         'Mayor''s Permit -- Standard (Renewal, tiered by prior year LBT paid)',
         'tiered', 'standard:renewal', 'preceding_year_lbt_paid', 'online', 201
  returning id
)
insert into fee_rule_brackets (fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order)
select fr.id, v.min_amount, v.max_amount, v.base_fee, v.rate, v.rate_basis, v.sort_order
from fr, (values
  -- v1.2: <300 -> 150; <=500 -> 250; >500 -> 350. The middle bracket's upper
  -- bound is genuinely inclusive of 500 (a real rule, not a formula
  -- continuity artifact) -- hence the +0.01 stand-in for an inclusive bound
  -- under this schema's exclusive-max convention.
  (0::numeric,      300::numeric, 150::numeric, 0::numeric, 'excess_over_min', 1),
  (300,      500.01,       250, 0, 'excess_over_min', 2),
  (500.01,   null,         350, 0, 'excess_over_min', 3)
) as v(min_amount, max_amount, base_fee, rate, rate_basis, sort_order);

-- ============================================================
-- 14. MAYOR'S PERMIT -- special business types (v1.2 getSpecialPermitFee())
--     All active: these are real rates the old system has been charging.
--     Flat/no-bracket types are grouped into one multi-row insert.
-- ============================================================

insert into fee_rules (lgu_id, name, computation_type, applies_to, flat_amount, delivery_mode, sort_order) values
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Night and Day Club', 'flat', 'night and day club', 1000, 'online', 210),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Night Club / Entertainment Club', 'flat', 'night club', 800, 'online', 211),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Entertainment Club', 'flat', 'entertainment club', 800, 'online', 212),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Cabaret / Dance Hall', 'flat', 'cabaret', 200, 'online', 213),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Dance Hall', 'flat', 'dance hall', 200, 'online', 214),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- KTV / Videoke Bar', 'flat', 'ktv/videoke bar', 800, 'online', 215),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Bar / Pub', 'flat', 'bar/pub', 300, 'online', 216),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Restobar', 'flat', 'restobar', 300, 'online', 217),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Swimming Pool', 'flat', 'swimming pool', 500, 'online', 218),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Lottery / Betting Station', 'flat', 'lottery/betting station', 200, 'online', 219),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Amusement Center / Arcade (per device, BPLO to verify count)', 'flat', 'amusement center/arcade', 50, 'online', 220),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Cockpit / Sabungan', 'flat', 'cockpit/sabungan', 200, 'online', 221),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Bowling Alley (Automatic)', 'flat', 'bowling alley', 500, 'online', 222),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Sports Complex / Court Rental (per court, BPLO to verify count)', 'flat', 'sports complex/court rental', 300, 'online', 223),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Pawnshop', 'flat', 'pawnshop', 500, 'online', 224),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Money Changer / Remittance', 'flat', 'money changer/remittance', 500, 'online', 225),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Lending Investor', 'flat', 'lending investor', 500, 'online', 226),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Credit Cooperative', 'flat', 'credit cooperative', 500, 'online', 227),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Rural Bank', 'flat', 'rural bank', 1000, 'online', 228),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Bank Branch (unspecified type)', 'flat', 'bank branch', 1000, 'online', 229),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Insurance Agency', 'flat', 'insurance agency', 200, 'online', 230),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Boarding House', 'flat', 'boarding house', 100, 'online', 231),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Cold Storage', 'flat', 'cold storage', 200, 'online', 232),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Cold Storage Facility', 'flat', 'cold storage facility', 200, 'online', 233),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Refrigerated Storage', 'flat', 'refrigerated storage', 200, 'online', 234),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Lumberyard', 'flat', 'lumberyard', 500, 'online', 235),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Lumber Dealer', 'flat', 'lumber dealer', 500, 'online', 236),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Lumber Yard', 'flat', 'lumber yard', 500, 'online', 237),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Used Car Lot', 'flat', 'used car lot', 300, 'online', 238),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Car Exchange', 'flat', 'car exchange', 300, 'online', 239),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Second-hand Car Dealer', 'flat', 'second-hand car dealer', 300, 'online', 240),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Used Vehicle Dealer', 'flat', 'used vehicle dealer', 300, 'online', 241),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Veterinary Clinic', 'flat', 'veterinary clinic', 200, 'online', 242),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Travel Agency', 'flat', 'travel agency', 200, 'online', 243),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Dance School / Studio', 'flat', 'dance school/studio', 200, 'online', 244),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Fitness Center / Gym', 'flat', 'fitness center/gym', 200, 'online', 245),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Sports Academy', 'flat', 'sports academy', 200, 'online', 246),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Vocational School', 'flat', 'vocational school', 200, 'online', 247),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Technical School', 'flat', 'technical school', 200, 'online', 248),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- TESDA-accredited School', 'flat', 'tesda-accredited school', 200, 'online', 249),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Technical-Vocational School', 'flat', 'technical-vocational school', 200, 'online', 250),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Piggery / Hog Raising', 'flat', 'piggery/hog raising', 500, 'online', 251),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Poultry Farm', 'flat', 'poultry farm', 500, 'online', 252),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Chicken Farm', 'flat', 'chicken farm', 500, 'online', 253),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Wholesale Liquor Dealer', 'flat', 'wholesale liquor dealer', 300, 'online', 254),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Liquor Wholesale', 'flat', 'liquor wholesale', 300, 'online', 255),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Events Place / Function Hall', 'flat', 'events place/function hall', 200, 'online', 256);

-- -- Commercial Bank: principal vs branch (is_branch_office-dependent) --
insert into fee_rules (lgu_id, name, computation_type, applies_to, flat_amount, delivery_mode, sort_order) values
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Commercial Bank (Principal Office)', 'flat', 'commercial bank:principal', 3000, 'online', 260),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Commercial Bank (Branch Office)', 'flat', 'commercial bank:branch', 2000, 'online', 261),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Savings Bank (Principal Office)', 'flat', 'savings bank:principal', 2000, 'online', 262),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Savings Bank (Branch Office)', 'flat', 'savings bank:branch', 1000, 'online', 263),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Finance & Investment Company (Principal Office)', 'flat', 'finance company:principal', 1000, 'online', 264),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Finance & Investment Company (Branch Office)', 'flat', 'finance company:branch', 500, 'online', 265),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Finance & Investment Company (Principal Office, alt. name)', 'flat', 'finance & investment company:principal', 1000, 'online', 266),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Finance & Investment Company (Branch Office, alt. name)', 'flat', 'finance & investment company:branch', 500, 'online', 267),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Investment Company (Principal Office)', 'flat', 'investment company:principal', 1000, 'online', 268),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Investment Company (Branch Office)', 'flat', 'investment company:branch', 500, 'online', 269);

-- -- Billiard Hall: per_unit (v1.2: 100 first table + 50/additional table,
--    algebraically identical to flat_amount=50 + per_unit_rate=50 * table_count) --
insert into fee_rules (lgu_id, name, computation_type, applies_to, flat_amount, per_unit_rate, per_unit_field, delivery_mode, sort_order)
select (select id from lgus where name = 'San Miguel'),
       'Mayor''s Permit -- Billiard Hall (PHP 100 first table + PHP 50/additional table)',
       'per_unit', 'billiard hall', 50, 50, 'billiard_table_count', 'online', 270;

-- -- Security Agency: per_unit (v1.2: 300 principal + 50 per locality) --
insert into fee_rules (lgu_id, name, computation_type, applies_to, flat_amount, per_unit_rate, per_unit_field, delivery_mode, sort_order)
select (select id from lgus where name = 'San Miguel'),
       'Mayor''s Permit -- Security Agency (PHP 300 principal + PHP 50/locality with posted guards)',
       'per_unit', 'security agency', 300, 50, 'locality_count', 'online', 271;

-- -- Cinema / Movie Theater: aircon vs non-aircon, tiered by seating_capacity --
with fr as (
  insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, delivery_mode, sort_order)
  select (select id from lgus where name = 'San Miguel'),
         'Mayor''s Permit -- Cinema / Movie Theater (Air-Conditioned)',
         'tiered', 'cinema/movie theater:aircon', 'seating_capacity', 'online', 280
  returning id
)
insert into fee_rule_brackets (fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order)
select fr.id, v.min_amount, v.max_amount, v.base_fee, v.rate, v.rate_basis, v.sort_order
from fr, (values
  (0::numeric,   500::numeric, 200::numeric, 0::numeric, 'excess_over_min', 1),
  (500,   1000,       400, 0, 'excess_over_min', 2),
  (1000,  null,        500, 0, 'excess_over_min', 3)
) as v(min_amount, max_amount, base_fee, rate, rate_basis, sort_order);

with fr as (
  insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, delivery_mode, sort_order)
  select (select id from lgus where name = 'San Miguel'),
         'Mayor''s Permit -- Cinema / Movie Theater (Non-Air-Conditioned)',
         'tiered', 'cinema/movie theater:nonaircon', 'seating_capacity', 'online', 281
  returning id
)
insert into fee_rule_brackets (fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order)
select fr.id, v.min_amount, v.max_amount, v.base_fee, v.rate, v.rate_basis, v.sort_order
from fr, (values
  -- v1.2's seatCount === 0 case ("itinerant operator", PHP 50) is the
  -- min_amount=0 row's exact boundary value; anyone with 1+ seats falls
  -- into the next bracket. sort_order 1 covers exactly 0 by treating
  -- max_amount as exclusive-of-1 rather than a generic small range.
  (0::numeric,     1::numeric,  50::numeric, 0::numeric, 'excess_over_min', 1),
  (1,       500,        100, 0, 'excess_over_min', 2),
  (500,    1000,        300, 0, 'excess_over_min', 3),
  (1000,   null,        400, 0, 'excess_over_min', 4)
) as v(min_amount, max_amount, base_fee, rate, rate_basis, sort_order);

-- -- Lodging types: tiered by lodger_count --
with fr as (
  insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, delivery_mode, sort_order)
  select (select id from lgus where name = 'San Miguel'),
         'Mayor''s Permit -- Lodging House / Inn / Dormitory / Transient House / Pension House',
         'tiered', 'lodging house', 'lodger_count', 'online', 290
  returning id
)
insert into fee_rule_brackets (fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order)
select fr.id, v.min_amount, v.max_amount, v.base_fee, v.rate, v.rate_basis, v.sort_order
from fr, (values
  (0::numeric,   15::numeric, 100::numeric, 0::numeric, 'excess_over_min', 1),
  (15,    35,         200, 0, 'excess_over_min', 2),
  (35,    null,       300, 0, 'excess_over_min', 3)
) as v(min_amount, max_amount, base_fee, rate, rate_basis, sort_order);

-- Duplicate the same lodging schedule under each alternate nature_of_business
-- string v1.2 recognizes for this fee (inn/lodge, dormitory/bedspace, etc.)
-- since applies_to only holds one value per row.
insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, delivery_mode, sort_order)
select (select id from lgus where name = 'San Miguel'), name, 'tiered', applies_to, 'lodger_count', 'online', sort_order
from (values
  ('Mayor''s Permit -- Inn / Lodge', 'inn/lodge', 291),
  ('Mayor''s Permit -- Dormitory / Bedspace', 'dormitory/bedspace', 292),
  ('Mayor''s Permit -- Transient House', 'transient house', 293),
  ('Mayor''s Permit -- Pension House', 'pension house', 294)
) as t(name, applies_to, sort_order);

-- Copy the lodging brackets onto each of those 4 alternate rows.
insert into fee_rule_brackets (fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order)
select fr2.id, b.min_amount, b.max_amount, b.base_fee, b.rate, b.rate_basis, b.sort_order
from fee_rule_brackets b
join fee_rules fr1 on fr1.id = b.fee_rule_id and fr1.applies_to = 'lodging house'
  and fr1.lgu_id = (select id from lgus where name = 'San Miguel')
join fee_rules fr2 on fr2.lgu_id = (select id from lgus where name = 'San Miguel')
  and fr2.applies_to in ('inn/lodge', 'dormitory/bedspace', 'transient house', 'pension house');

-- -- Real Estate Dealer/Brokerage: tiered by land_area_hectares --
with fr as (
  insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, delivery_mode, sort_order)
  select (select id from lgus where name = 'San Miguel'),
         'Mayor''s Permit -- Real Estate Dealer / Brokerage',
         'tiered', 'real estate brokerage', 'land_area_hectares', 'online', 300
  returning id
)
insert into fee_rule_brackets (fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order)
select fr.id, v.min_amount, v.max_amount, v.base_fee, v.rate, v.rate_basis, v.sort_order
from fr, (values
  (0::numeric,   5::numeric, 200::numeric, 0::numeric, 'excess_over_min', 1),
  (5,    10,          400, 0, 'excess_over_min', 2),
  (10,   null,        600, 0, 'excess_over_min', 3)
) as v(min_amount, max_amount, base_fee, rate, rate_basis, sort_order);

-- -- Subdivision Developer: tiered by land_area_hectares --
with fr as (
  insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, delivery_mode, sort_order)
  select (select id from lgus where name = 'San Miguel'),
         'Mayor''s Permit -- Property Developer / Subdivision',
         'tiered', 'property developer/subdivision', 'land_area_hectares', 'online', 301
  returning id
)
insert into fee_rule_brackets (fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order)
select fr.id, v.min_amount, v.max_amount, v.base_fee, v.rate, v.rate_basis, v.sort_order
from fr, (values
  (0::numeric,   5::numeric,  500::numeric, 0::numeric, 'excess_over_min', 1),
  (5,    10,          1000, 0, 'excess_over_min', 2),
  (10,   null,        1500, 0, 'excess_over_min', 3)
) as v(min_amount, max_amount, base_fee, rate, rate_basis, sort_order);

-- -- Memorial Park / Private Cemetery: 2-tier by land_area_hectares --
with fr as (
  insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, delivery_mode, sort_order)
  select (select id from lgus where name = 'San Miguel'),
         'Mayor''s Permit -- Private Cemetery / Memorial Park',
         'tiered', 'private cemetery', 'land_area_hectares', 'online', 302
  returning id
)
insert into fee_rule_brackets (fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order)
select fr.id, v.min_amount, v.max_amount, v.base_fee, v.rate, v.rate_basis, v.sort_order
from fr, (values
  (0::numeric,   2::numeric, 1000::numeric, 0::numeric, 'excess_over_min', 1),
  (2,    null,        3000, 0, 'excess_over_min', 2)
) as v(min_amount, max_amount, base_fee, rate, rate_basis, sort_order);

-- Duplicate under the other 3 nature_of_business aliases v1.2 recognizes.
insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, delivery_mode, sort_order)
select (select id from lgus where name = 'San Miguel'), name, 'tiered', applies_to, 'land_area_hectares', 'online', sort_order
from (values
  ('Mayor''s Permit -- Memorial Park', 'memorial park', 303),
  ('Mayor''s Permit -- Private Memorial Park', 'private memorial park', 304),
  ('Mayor''s Permit -- Cemetery', 'cemetery', 305)
) as t(name, applies_to, sort_order);

insert into fee_rule_brackets (fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order)
select fr2.id, b.min_amount, b.max_amount, b.base_fee, b.rate, b.rate_basis, b.sort_order
from fee_rule_brackets b
join fee_rules fr1 on fr1.id = b.fee_rule_id and fr1.applies_to = 'private cemetery'
  and fr1.lgu_id = (select id from lgus where name = 'San Miguel')
join fee_rules fr2 on fr2.lgu_id = (select id from lgus where name = 'San Miguel')
  and fr2.applies_to in ('memorial park', 'private memorial park', 'cemetery');

-- -- Private Warehouse / Bodega: tiered by floor_area_sqm --
with fr as (
  insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, delivery_mode, sort_order)
  select (select id from lgus where name = 'San Miguel'),
         'Mayor''s Permit -- Private Warehouse / Bodega',
         'tiered', 'warehouse/storage facility', 'floor_area_sqm', 'online', 310
  returning id
)
insert into fee_rule_brackets (fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order)
select fr.id, v.min_amount, v.max_amount, v.base_fee, v.rate, v.rate_basis, v.sort_order
from fr, (values
  (0::numeric,   50::numeric,  150::numeric, 0::numeric, 'excess_over_min', 1),
  (50,   100,         200, 0, 'excess_over_min', 2),
  (100,  200,         300, 0, 'excess_over_min', 3),
  (200,  300,         400, 0, 'excess_over_min', 4),
  (300,  400,         500, 0, 'excess_over_min', 5),
  (400,  null,        600, 0, 'excess_over_min', 6)
) as v(min_amount, max_amount, base_fee, rate, rate_basis, sort_order);

-- ============================================================
-- 15. MAYOR'S PERMIT -- v2.0-only additions, NOT in v1.2 (INACTIVE)
--     Per project owner decision 2026-08-11: seeded but is_active = false.
--     Flip to true only after BPLO confirms San Miguel actually charges
--     these. Amounts below are transcribed as-is from
--     reference/MuniServe_FeeComputation_ChatGPT_Prompt.md sections 4.01-4.10
--     -- NOT cross-checked against the actual ordinance text.
-- ============================================================

insert into fee_rules (lgu_id, name, computation_type, applies_to, flat_amount, delivery_mode, is_active, sort_order) values
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Skating Rink (v2.0, unconfirmed)', 'flat', 'skating rink', 100, 'online', false, 400),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Bowling Alley, Non-Automatic (v2.0, unconfirmed)', 'flat', 'bowling alley non-automatic', 300, 'online', false, 401),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Boxing Stadium (v2.0, unconfirmed)', 'flat', 'boxing stadium', 200, 'online', false, 402),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Race Track (v2.0, unconfirmed)', 'flat', 'race track', 500, 'online', false, 403),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Pelota Court / Tennis Court, per court (v2.0, unconfirmed)', 'flat', 'pelota/tennis court', 300, 'online', false, 404),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Golf Link (v2.0, unconfirmed)', 'flat', 'golf link', 300, 'online', false, 405),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Mini Golf Link (v2.0, unconfirmed)', 'flat', 'mini golf link', 200, 'online', false, 406),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Refrigeration Cases, stand-alone (v2.0, unconfirmed)', 'flat', 'refrigeration cases', 50, 'online', false, 407),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Flammable/Explosive Products Storage (v2.0, unconfirmed)', 'flat', 'flammable storage', 200, 'online', false, 408),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Professional Principal Office (v2.0, unconfirmed)', 'flat', 'professional principal office', 300, 'online', false, 409),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Insurance Company, Principal Office (v2.0, unconfirmed -- distinct from Insurance Agency)', 'flat', 'insurance company:principal', 1000, 'online', false, 410),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Insurance Company, Branch Office (v2.0, unconfirmed)', 'flat', 'insurance company:branch', 800, 'online', false, 411),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Wholesale Foreign Liquor (v2.0, unconfirmed)', 'flat', 'liquor:wholesale_foreign', 300, 'online', false, 412),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Wholesale Domestic Liquor (v2.0, unconfirmed)', 'flat', 'liquor:wholesale_domestic', 150, 'online', false, 413),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Wholesale Fermented Liquor (v2.0, unconfirmed)', 'flat', 'liquor:wholesale_fermented', 200, 'online', false, 414),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Retail Vino (v2.0, unconfirmed)', 'flat', 'liquor:retail_vino', 150, 'online', false, 415),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Retail Foreign Liquor (v2.0, unconfirmed)', 'flat', 'liquor:retail_foreign', 150, 'online', false, 416),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Retail Domestic Liquor (v2.0, unconfirmed)', 'flat', 'liquor:retail_domestic', 100, 'online', false, 417),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Retail Fermented Liquor (v2.0, unconfirmed)', 'flat', 'liquor:retail_fermented', 150, 'online', false, 418),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Retail Tuba / Basi / Tapuy (v2.0, unconfirmed)', 'flat', 'liquor:retail_tuba', 150, 'online', false, 419),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Tobacco Dealer (v2.0, unconfirmed)', 'flat', 'tobacco dealer', 150, 'online', false, 420),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Promoter / Sponsor / Talent Scout / Booking Agent (v2.0, unconfirmed)', 'flat', 'promoter/sponsor', 150, 'online', false, 421),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- All Other Businesses catch-all, v2.0 alternative to standard tiered rate (v2.0, unconfirmed -- CONFLICTS with the active standard:new/standard:renewal rules, see CLAUDE.md section 7)', 'flat', 'catchall_v2_alternative', 200, 'online', false, 499);

-- Liaison / Administrative Office: tiered by floor_area_sqm (v2.0, unconfirmed)
with fr as (
  insert into fee_rules (lgu_id, name, computation_type, applies_to, basis_field, delivery_mode, is_active, sort_order)
  select (select id from lgus where name = 'San Miguel'),
         'Mayor''s Permit -- Liaison / Administrative Office (v2.0, unconfirmed)',
         'tiered', 'liaison/administrative office', 'floor_area_sqm', 'online', false, 430
  returning id
)
insert into fee_rule_brackets (fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order)
select fr.id, v.min_amount, v.max_amount, v.base_fee, v.rate, v.rate_basis, v.sort_order
from fr, (values
  (0::numeric,  50::numeric, 100::numeric, 0::numeric, 'excess_over_min', 1),
  (50,   200,        200, 0, 'excess_over_min', 2),
  (200,  500,        300, 0, 'excess_over_min', 3),
  (500,  null,       500, 0, 'excess_over_min', 4)
) as v(min_amount, max_amount, base_fee, rate, rate_basis, sort_order);
