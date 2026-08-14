-- Fee-engine generalization (2026-08-14 follow-up, big one): the assessment
-- card used to identify what a fee_rules row *was* by sniffing its `name`
-- string ("LBT Schedule%") or computation_type (formula_increment ==
-- CEDULA) -- fragile, and it meant the display label was always whatever
-- specific rule matched ("LBT Schedule B -- Wholesaler...") instead of a
-- consistent category label ("Local Business Tax"). This migration adds an
-- explicit `fee_category` discriminator, a new `tier_matrix` computation
-- shape (needed once a second real LGU -- San Ildefonso -- turned out to
-- classify Mayor's Permit Fee by business-size tier x category instead of
-- San Miguel's per-named-business-type catalog), and the "Automated
-- Assessment" manual-override toggle the project owner asked for as a
-- safety valve if any of this ever computes something wrong.
--
-- ============================================================
-- fee_rules: fee_category (matching + display discriminator)
-- ============================================================
-- 'discount' covers the Essential Commodity Discount -- its own category,
-- not folded into 'lbt', since it's a separate negative line, not a tax
-- schedule itself.
alter table fee_rules add column fee_category text
  check (fee_category in ('mayors_permit', 'lbt', 'cedula', 'regulatory', 'discount'));

-- Backfill San Miguel's existing 119 rows -- verified against production
-- before writing this (9 LBT Schedule rows, 2 CEDULA, 1 discount, 107
-- Mayor's Permit rows including the standard:new/standard:renewal
-- fallback) -- same logic the old name-sniffing used, run once here so
-- every existing row ends up correctly tagged without anyone re-typing it.
update fee_rules set fee_category = 'lbt' where name like 'LBT Schedule%';
update fee_rules set fee_category = 'cedula' where computation_type = 'formula_increment';
update fee_rules set fee_category = 'discount' where computation_type = 'discount_subset';
update fee_rules set fee_category = 'mayors_permit' where fee_category is null;

alter table fee_rules alter column fee_category set not null;

-- ============================================================
-- fee_rules: new 'tier_matrix' computation shape
-- ============================================================
-- San Ildefonso's Mayor's Permit Fee isn't a per-business-type catalog at
-- all -- it's a business-size tier (Cottage/Small/Medium/Large, per the
-- national MSME asset/employee-count classification) crossed with a
-- handful of coarse categories. One fee_rules row per category (Mayor's
-- Permit -- Manufacturers/Importers/Producers, etc.), matched by
-- applies_to same as every other Mayor's Permit row; its actual amounts
-- live in fee_rule_brackets (see below) instead of one flat_amount, since
-- there are up to 4 tier cells per category.
alter table fee_rules drop constraint fee_rules_computation_type_check;
alter table fee_rules add constraint fee_rules_computation_type_check
  check (computation_type in (
    'flat', 'per_unit', 'tiered', 'flat_percentage', 'tiered_percentage',
    'formula_increment', 'discount_subset', 'discount_percentage', 'time_surcharge',
    'tier_matrix'
  ));

-- ============================================================
-- fee_rule_brackets: reused for tier_matrix rows, not a new table
-- ============================================================
-- A tier_matrix "bracket" isn't a continuous min/max range -- it's one
-- discrete labeled tier (Cottage/Small/Medium/Large) with a flat amount.
-- Reusing this table rather than adding a parallel fee_rule_matrix_cells
-- table: same shape (fee_rule_id, an identifier, an amount, an order),
-- and it means one bracket-editor UI component can serve both the
-- graduated (LBT/Sanitary/Garbage) and tier_matrix (Mayor's Permit,
-- San-Ildefonso-shaped) cases, just switching which columns it shows.
-- min_amount/max_amount/rate stay null and unused for a tier_matrix row;
-- base_fee holds the tier's flat amount; sort_order orders the 4 tiers.
alter table fee_rule_brackets add column tier_label text;
alter table fee_rule_brackets alter column min_amount drop not null;

-- ============================================================
-- lgus: Automated Assessment toggle
-- ============================================================
-- The project owner's own words: "a safe place to go if whatever we
-- design fails." BPLO-controlled (not platform-admin, unlike is_paused),
-- so it lives on lgus alongside display_name/bplo_office_name (migration
-- 0017), not paused_at (which is a platform-admin-only lever, migration
-- 0020). Defaults true -- nobody's assessment behavior changes until a
-- BPLO deliberately flips it off.
alter table lgus add column automated_assessment_enabled boolean not null default true;

-- ============================================================
-- application_fee_lines: category + label + manual-entry provenance
-- ============================================================
-- fee_rule_id was already nullable (no staff-facing INSERT used it that
-- way before, but the column itself never had a not-null constraint) --
-- a manually-entered line (Automated Assessment off) has no single
-- fee_rules row to point at, since automation was bypassed entirely for
-- that line. fee_category/display_label are captured at finalize time,
-- same "denormalize at the moment of the event" reasoning as
-- audit_log.actor_label (migration 0022) -- a report reading last year's
-- assessments must show what was actually charged and labeled then, not
-- whatever fee_rules looks like today if a rule's name or category ever
-- changes later.
alter table application_fee_lines add column fee_category text;
alter table application_fee_lines add column display_label text;
alter table application_fee_lines add column is_manual boolean not null default false;
