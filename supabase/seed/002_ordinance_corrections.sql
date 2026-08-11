-- ============================================================
-- CORRECTIONS FROM READING THE ACTUAL SAN MIGUEL REVENUE CODE
-- ============================================================
-- Source: reference/revenue-code-scans/ (17-page scan, read 2026-08-11).
-- See CLAUDE.md section 7a for the full account of what this corrects and
-- what's still left open (essential-commodity category mapping, cinema
-- fee restructure, the disputed flat-PHP200 catch-all, the Retailer
-- schedule's ambiguous "P30,000" phrase, Memorial Park's >2 vs >=2
-- hectare boundary). This script only fixes what was clearly resolvable.
--
-- Requires migration 0004 (fee_rules.new_business_rate) to already be applied.
-- Safe to re-run.

-- ============================================================
-- 1. NEW-BUSINESS LBT: 1% of capital investment, floored at the schedule
--    minimum -- NOT a bracket lookup. Scope: Section 5 (a)-(i), i.e. every
--    LBT schedule except (j) Lessor.
-- ============================================================

update fee_rules
set new_business_rate = 0.01
where lgu_id = (select id from lgus where name = 'San Miguel')
  and applies_to in ('manufacturer', 'wholesaler', 'retailer', 'contractor', 'bank_financial', 'food_beverage', 'amusement', 'all')
  and computation_type in ('tiered', 'tiered_percentage', 'flat_percentage')
  and name like 'LBT Schedule%';

-- ============================================================
-- 2. ACTIVATE the 23 v2.0 fees confirmed word-for-word against the actual
--    ordinance (leaving the disputed flat-PHP200 catch-all inactive).
-- ============================================================

update fee_rules
set is_active = true,
    name = name || ' (confirmed against actual ordinance 2026-08-11)'
where lgu_id = (select id from lgus where name = 'San Miguel')
  and applies_to in (
    'skating rink', 'bowling alley non-automatic', 'boxing stadium', 'race track',
    'pelota/tennis court', 'golf link', 'mini golf link', 'refrigeration cases',
    'flammable storage', 'professional principal office',
    'insurance company:principal', 'insurance company:branch',
    'liquor:wholesale_foreign', 'liquor:wholesale_domestic', 'liquor:wholesale_fermented',
    'liquor:retail_vino', 'liquor:retail_foreign', 'liquor:retail_domestic',
    'liquor:retail_fermented', 'liquor:retail_tuba',
    'tobacco dealer', 'promoter/sponsor', 'liaison/administrative office'
  );

-- ============================================================
-- 3. NEW fee items found in the ordinance that neither v1.2 nor v2.0 had.
-- ============================================================

insert into fee_rules (lgu_id, name, computation_type, applies_to, flat_amount, delivery_mode, sort_order) values
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Boxing Contest (per fight)', 'flat', 'boxing contest', 50, 'online', 500),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Special Permit for Civic/Religious/Social Org Events (free per ordinance Sec. 2.22)', 'flat', 'civic event permit', 0, 'online', 501),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Stage Shows / Fashion Shows', 'flat', 'stage/fashion show', 100, 'online', 502),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Benefit Balls / Raffles / Bingo Games', 'flat', 'benefit ball/raffle/bingo', 100, 'online', 503),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Fiesta "Tienda"/Store (per occasion)', 'flat', 'fiesta tienda', 20, 'online', 504),
((select id from lgus where name = 'San Miguel'), 'Mayor''s Permit -- Dealer of Securities / Foreign Exchange', 'flat', 'dealer of securities/forex', 500, 'online', 505);

-- Merry-go-rounds/roller coasters/carnivals/circuses: PHP 100 covers the
-- first 10 operating days, PHP 50/day after that. Modeled as per_unit with
-- the convention documented here: per_unit_field counts only days BEYOND
-- the first 10 (i.e. 0 for a 10-day-or-shorter run), not total days run.
insert into fee_rules (lgu_id, name, computation_type, applies_to, flat_amount, per_unit_rate, per_unit_field, delivery_mode, sort_order)
select (select id from lgus where name = 'San Miguel'),
       'Mayor''s Permit -- Carnival/Circus/Traveling Amusement (PHP 100 first 10 days + PHP 50/day after)',
       'per_unit', 'carnival/circus', 100, 50, 'operating_days_beyond_ten', 'online', 506;
