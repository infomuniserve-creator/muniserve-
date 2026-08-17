/**
 * Fee computation engine (build order step 7; generalized 2026-08-14 after
 * a second real LGU -- San Ildefonso -- turned out to structure Mayor's
 * Permit Fee completely differently from San Miguel's).
 *
 * Every fee_rules row now carries a `fee_category` (`lbt` / `mayors_permit`
 * / `cedula` / `regulatory` / `discount`) -- an explicit discriminator that
 * replaces the old name-sniffing (`name.startsWith("LBT Schedule")`,
 * `computation_type === "formula_increment"` meaning CEDULA). This is what
 * lets the assessment card show a fixed, LGU-independent label per
 * category ("Mayor's Permit Fee", "Local Business Tax") instead of
 * whichever specific row matched ("LBT Schedule B -- Wholesaler..."), and
 * lets `regulatory` rows (CNC, Sanitary Fee, whatever a BPLO adds in
 * Settings) be picked up generically instead of needing new engine code
 * per fee name.
 *
 * Three computation *shapes*, not tied 1:1 to fee_category -- any category
 * can use any shape that makes sense for it:
 *   - flat: one amount (most `regulatory` rows; San Miguel's Mayor's
 *     Permit "standard:new").
 *   - graduated (tiered/tiered_percentage/flat_percentage + brackets): a
 *     basis-driven bracket table, unchanged from the original engine.
 *     Used by every LBT schedule, and by `regulatory` rows like a
 *     floor-area-graduated Sanitary/Garbage Fee.
 *   - tier_matrix: a business-size tier (Cottage/Small/Medium/Large, the
 *     national MSME asset-or-employee-count classification) crossed with
 *     a coarse category -- San Ildefonso's Mayor's Permit shape. Reuses
 *     fee_rule_brackets (see migration 0026's comment) with `tier_label`
 *     instead of a min/max range.
 *
 * San Miguel's own 119 fee_rules rows were backfilled with fee_category in
 * migration 0026 using the exact same logic this file used to hardcode --
 * every existing computation path below (LBT, discount, Mayor's Permit
 * named-catalog + standard fallback, CEDULA) is unchanged in behavior,
 * only in how it identifies which rows to look at.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type FeeLineResult = {
  feeRuleId: string | null; // null for a manually-entered line (Automated Assessment off)
  feeCategory: "mayors_permit" | "lbt" | "cedula" | "regulatory" | "discount" | "barangay_clearance";
  displayLabel: string;
  amount: number; // negative for the discount line
  includedInTotal: boolean; // false for a reference_only regulatory fee, still shown with a "paid at the counter" note -- CEDULA is the one exception: a reference_only CEDULA rule isn't pushed as a line at all (2026-08-16 follow-up), so this is always true whenever a cedula-category line exists
  note?: string; // shown to BPLO -- e.g. "estimated, please confirm"
  isManual?: boolean;
  acctCode: string | null; // migration 0039 -- the LGU's own revenue-code numbering (e.g. "605-1"), optional/blank by default, for the Order of Payment slip. null for a manually-entered line (Automated Assessment off), same as feeRuleId.
  /** Whether Automated Assessment being off swaps this line for a hand-entered amount. Always true for lbt/mayors_permit (the two the project owner named directly) and for any `regulatory` line computed from a non-flat shape (graduated/tier_matrix) -- a flat amount has nothing a bracket lookup can get wrong, so it stays automatic either way. */
  isManualEligible: boolean;
};

export type FeeComputationResult =
  | { ok: true; lines: FeeLineResult[]; total: number; warnings: string[] }
  | { ok: false; blockedReason: string };

type FeeRuleRow = {
  id: string;
  name: string;
  fee_category: "mayors_permit" | "lbt" | "cedula" | "regulatory" | "discount" | "barangay_clearance";
  computation_type: string;
  applies_to: string | null;
  basis_field: string | null;
  flat_amount: number | null;
  per_unit_rate: number | null;
  per_unit_field: string | null;
  percentage_rate: number | null;
  formula_base_fee: number | null;
  formula_increment_amount: number | null;
  formula_increment_per: number | null;
  formula_cap: number | null;
  discount_target_fee_rule_ids: string[] | null;
  new_business_rate: number | null;
  delivery_mode: string;
  acct_code: string | null;
};

type BracketRow = {
  fee_rule_id: string;
  min_amount: number | null;
  max_amount: number | null;
  base_fee: number;
  rate: number;
  rate_basis: "excess_over_min" | "full_amount" | null;
  tier_label: string | null;
  sort_order: number;
};

export type FeeComputationInput = {
  lguId: string;
  applicationType: "new" | "renewal";
  capitalInvestment: number | null;
  grossSales: number | null;
  business: {
    natureOfBusiness: string | null;
    lbtCategory: string | null;
    organizationType: string | null;
    isBranchOffice: boolean | null;
    isAircon: boolean | null;
    seatingCapacity: number | null;
    lodgerCount: number | null;
    landAreaHectares: number | null;
    warehouseFloorAreaSqm: number | null;
    totalFloorAreaSqm: string | null; // stored as text on businesses
    billiardTableCount: number | null;
    guardPostCount: number | null;
    animalCount: number | null;
    maleEmployeeCount: number | null;
    femaleEmployeeCount: number | null;
    barangay: string | null;
    hasBarangayClearance: string | null; // "Yes" or "No, generate my Brgy. clearance" -- the applicant form's own field, san-miguel-form-options.ts's BARANGAY_CLEARANCE_OPTIONS
  };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Fixed labels for the categories with an established generic name (project owner's explicit ask, 2026-08-14) -- `regulatory`/`discount`/`cedula` rows show their own `name` instead, since those are meant to read as the specific thing they are. */
const CATEGORY_LABEL: Partial<Record<FeeRuleRow["fee_category"], string>> = {
  mayors_permit: "Mayor's Permit Fee",
  lbt: "Local Business Tax",
  barangay_clearance: "Barangay Clearance",
};

function bracketFor(basis: number, brackets: BracketRow[]): BracketRow | null {
  const sorted = [...brackets].sort((a, b) => a.sort_order - b.sort_order);
  return sorted.find((b) => b.min_amount != null && basis >= b.min_amount && (b.max_amount == null || basis < b.max_amount)) ?? null;
}

function bracketAmount(basis: number, bracket: BracketRow): number {
  if (bracket.rate_basis === "full_amount") return bracket.base_fee + bracket.rate * basis;
  return bracket.base_fee + bracket.rate * (basis - (bracket.min_amount ?? 0));
}

// ============================================================
// Business-size tier (Cottage/Small/Medium/Large) -- San Ildefonso's
// Mayor's Permit Fee classification, matching the national MSME
// asset-value-or-employee-count standard as printed in its own ordinance
// (read directly from the source, not guessed): "the permit fee shall be
// based on asset size or number of workers, whichever will yield the
// higher fee." Treated as a shared, LGU-independent constant for now
// (not a per-LGU-editable setting) -- flagged rather than silently
// assumed: revisit if a future tier_matrix-shaped LGU turns out to use
// different boundaries.
// ============================================================

const SIZE_TIERS = ["cottage", "small", "medium", "large"] as const;
export type SizeTier = (typeof SIZE_TIERS)[number];

function tierByAssets(assetValue: number): SizeTier {
  if (assetValue <= 500_000) return "cottage";
  if (assetValue <= 5_000_000) return "small";
  if (assetValue <= 20_000_000) return "medium";
  return "large";
}

function tierByEmployees(employeeCount: number): SizeTier {
  if (employeeCount <= 10) return "cottage";
  if (employeeCount <= 99) return "small";
  if (employeeCount <= 199) return "medium";
  return "large";
}

/**
 * Resolves the higher-yielding of the asset-based and employee-based
 * tiers, per the ordinance's own "whichever will yield the higher fee"
 * rule. Asset value uses `capitalInvestment` as its proxy for a `new`
 * application (the same figure LBT's own `new_business_rate` already
 * treats as the basis) -- there's no captured "current total assets"
 * figure for a `renewal`, so that case falls back to employee count alone
 * and the caller attaches a note flagging the approximation, the same
 * pattern `resolveBasis`'s `preceding_year_lbt_paid` case already uses
 * elsewhere in this file for an identical kind of missing-data gap.
 */
function resolveSizeTier(
  applicationType: "new" | "renewal",
  capitalInvestment: number | null,
  employeeCount: number | null
): { tier: SizeTier; approximated: boolean } | null {
  const assetValue = applicationType === "new" ? capitalInvestment : null;
  const tierFromAssets = assetValue != null ? tierByAssets(assetValue) : null;
  const tierFromEmployees = employeeCount != null ? tierByEmployees(employeeCount) : null;
  if (tierFromAssets == null && tierFromEmployees == null) return null;
  if (tierFromAssets == null) return { tier: tierFromEmployees as SizeTier, approximated: true };
  if (tierFromEmployees == null) return { tier: tierFromAssets, approximated: false };
  const higher = SIZE_TIERS.indexOf(tierFromAssets) >= SIZE_TIERS.indexOf(tierFromEmployees) ? tierFromAssets : tierFromEmployees;
  return { tier: higher, approximated: false };
}

/** flat / per_unit / tiered / tiered_percentage / flat_percentage / formula_increment -- discount_subset and tier_matrix are handled separately, since neither is a plain basis-driven lookup. */
function computeRuleAmount(
  rule: FeeRuleRow,
  brackets: BracketRow[],
  basis: number | null,
  perUnitCount: number | null,
  applicationType: "new" | "renewal"
): number | { error: string } {
  switch (rule.computation_type) {
    case "flat":
      return rule.flat_amount ?? 0;

    case "per_unit":
      // e.g. Security Agency is "₱300 principal + ₱50/locality" -- the
      // flat_amount is a real base, not an unused leftover column.
      if (perUnitCount == null) return { error: `"${rule.name}" needs a unit count that isn't on file for this business.` };
      return (rule.flat_amount ?? 0) + (rule.per_unit_rate ?? 0) * perUnitCount;

    case "formula_increment": {
      if (basis == null) return { error: `"${rule.name}" has no basis amount to compute from.` };
      const per = rule.formula_increment_per ?? 1;
      const increments = Math.ceil(basis / per);
      const amount = (rule.formula_base_fee ?? 0) + increments * (rule.formula_increment_amount ?? 0);
      return rule.formula_cap != null ? Math.min(amount, rule.formula_cap) : amount;
    }

    case "flat_percentage":
      if (basis == null) return { error: `"${rule.name}" has no basis amount to compute from.` };
      return basis * (rule.percentage_rate ?? 0);

    case "tiered":
    case "tiered_percentage": {
      if (basis == null) return { error: `"${rule.name}" has no basis amount to compute from.` };
      // New applications on a graduated schedule use a flat rate off
      // capital investment instead of the bracket table, floored at the
      // schedule's lowest bracket -- CLAUDE.md 7a / the ordinance
      // correction's note #1, "1% of capital investment, floored at the
      // schedule minimum -- NOT a bracket lookup."
      if (applicationType === "new" && rule.new_business_rate != null) {
        const floor = bracketFor(0, brackets)?.base_fee ?? 0;
        return Math.max(basis * rule.new_business_rate, floor);
      }
      const bracket = bracketFor(basis, brackets);
      if (!bracket) return { error: `"${rule.name}" has no bracket covering ${basis}.` };
      return bracketAmount(basis, bracket);
    }

    default:
      return { error: `"${rule.name}" uses an unsupported computation type (${rule.computation_type}) for this pass.` };
  }
}

/** Resolves a rule's basis_field to an actual number for this business/application. Fields with no real data source yet return null rather than a guess. */
function resolveBasis(rule: FeeRuleRow, input: FeeComputationInput, lbtBasis: number | null, thisYearLbtAmount: number | null): number | null {
  switch (rule.basis_field) {
    case "lbt_basis":
      return lbtBasis;
    case "seating_capacity":
      return input.business.seatingCapacity;
    case "lodger_count":
      return input.business.lodgerCount;
    case "land_area_hectares":
      return input.business.landAreaHectares;
    case "floor_area_sqm":
      // The one basis_field whose real source column depends on context:
      // the dedicated warehouse field for warehouse/cold-storage
      // businesses, the generic (free-text) one otherwise. Also the basis
      // a graduated `regulatory` fee (Sanitary/Garbage-Fee-shaped) uses.
      if ((input.business.natureOfBusiness ?? "").toLowerCase().includes("warehouse") || (input.business.natureOfBusiness ?? "").toLowerCase().includes("cold storage")) {
        return input.business.warehouseFloorAreaSqm;
      }
      return input.business.totalFloorAreaSqm != null ? Number(input.business.totalFloorAreaSqm) || null : null;
    case "preceding_year_lbt_paid":
      // No per-business history of what was actually assessed/paid last
      // year exists yet for most businesses (this is this pilot's first
      // year on MuniServe). Approximated with THIS year's just-computed
      // LBT amount -- same basis, same business, not a different source
      // -- rather than reaching into permit_history's lump-sum
      // (Mayor's-Permit-plus-LBT-plus-other-fees combined) historical
      // amount_paid, which would conflate several fee components into
      // one number. Low-stakes either way: this only selects one of
      // three ~₱150-350 tiers.
      return thisYearLbtAmount;
    default:
      return null;
  }
}

function resolvePerUnitCount(rule: FeeRuleRow, input: FeeComputationInput): number | null {
  switch (rule.per_unit_field) {
    case "billiard_table_count":
      return input.business.billiardTableCount;
    case "locality_count": // the form's own label is "localities with posted guards"
      return input.business.guardPostCount;
    case "operating_days_beyond_ten":
      // Not captured anywhere -- Carnival/Circus/Traveling Amusement
      // never got a "how many days" field on the applicant form. Real
      // gap, not guessed.
      return null;
    default:
      return null;
  }
}

/** Finds the specific-business-type Mayor's Permit rule for this business (San Miguel's shape): a specific match first (resolving :branch/:aircon variants), the standard:new/standard:renewal fallback otherwise. */
function findMayorsPermitCatalogRule(rules: FeeRuleRow[], nature: string, isBranchOffice: boolean | null, isAircon: boolean | null, applicationType: "new" | "renewal"): FeeRuleRow | null {
  const candidates = rules.filter((r) => r.fee_category === "mayors_permit" && r.applies_to);

  const variantMatches = candidates.filter((r) => {
    const [key, variant] = (r.applies_to as string).split(":");
    if (key !== nature) return false;
    if (!variant) return true;
    if (variant === "branch") return isBranchOffice === true;
    if (variant === "principal") return isBranchOffice !== true;
    if (variant === "aircon") return isAircon === true;
    if (variant === "nonaircon") return isAircon !== true;
    return false; // liquor's wholesale_*/retail_* variants -- no field captures which one, can't resolve
  });
  if (variantMatches.length > 0) return variantMatches[0];

  // A business type appears in the rule set but none of its liquor-style
  // sub-variants could be resolved (no data for which one) -- report
  // that as a gap rather than silently falling through to "standard."
  const unresolvedVariant = candidates.some((r) => (r.applies_to as string).split(":")[0] === nature);
  if (unresolvedVariant) return null;

  return rules.find((r) => r.fee_category === "mayors_permit" && r.applies_to === `standard:${applicationType}`) ?? null;
}

/**
 * Finds the matching category row for a tier_matrix-shaped fee (San
 * Ildefonso's Mayor's Permit shape, or any future LGU using the same
 * shape) -- one fee_rules row per coarse category, matched against
 * nature_of_business the same "specific match, else a designated
 * fallback" convention as the catalog shape above. The fallback here is
 * `applies_to = 'tier_matrix_default'` (San Ildefonso's own ordinance
 * literally has a catch-all "5. Other Businesses" category for exactly
 * this -- not an invented convention).
 */
function findTierMatrixCategoryRule(rows: FeeRuleRow[], nature: string): FeeRuleRow | null {
  return rows.find((r) => r.applies_to === nature) ?? rows.find((r) => r.applies_to === "tier_matrix_default") ?? null;
}

/**
 * A "regulatory" fee (CNC, Sanitary Fee, Garbage Fee, whatever a BPLO
 * adds in Settings) can be a single unconditional flat row, or -- if the
 * LGU's own ordinance varies it by business category (Garbage-Fee-shaped)
 * -- several rows sharing the same `name`, each with its own `applies_to`
 * category and its own basis/brackets. Grouping by `name` rather than a
 * new dedicated column: it's already the field BPLO types into Settings,
 * and it's exactly the same "several rows, one displayed concept"
 * pattern the Mayor's Permit catalog already uses (many specifically-
 * named rows, one fixed display label).
 */
function groupRegulatoryRules(rules: FeeRuleRow[]): Map<string, FeeRuleRow[]> {
  const groups = new Map<string, FeeRuleRow[]>();
  for (const r of rules.filter((r) => r.fee_category === "regulatory")) {
    const list = groups.get(r.name) ?? [];
    list.push(r);
    groups.set(r.name, list);
  }
  return groups;
}

export async function computeApplicationFees(supabase: SupabaseClient, input: FeeComputationInput): Promise<FeeComputationResult> {
  if (!input.business.lbtCategory) {
    return { ok: false, blockedReason: "This business has no LBT category set yet. Set it in the Business Registry before this application can be assessed." };
  }

  const { data: rulesRaw, error: rulesError } = await supabase
    .from("fee_rules")
    .select(
      "id, name, fee_category, computation_type, applies_to, basis_field, flat_amount, per_unit_rate, per_unit_field, percentage_rate, formula_base_fee, formula_increment_amount, formula_increment_per, formula_cap, discount_target_fee_rule_ids, new_business_rate, delivery_mode, acct_code"
    )
    .eq("lgu_id", input.lguId)
    .eq("is_active", true);
  if (rulesError) return { ok: false, blockedReason: `Could not load fee rules: ${rulesError.message}` };
  const rules = (rulesRaw ?? []) as FeeRuleRow[];

  const { data: bracketsRaw, error: bracketsError } = await supabase
    .from("fee_rule_brackets")
    .select("fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, tier_label, sort_order")
    .in("fee_rule_id", rules.map((r) => r.id));
  if (bracketsError) return { ok: false, blockedReason: `Could not load fee brackets: ${bracketsError.message}` };
  const bracketsByRule = new Map<string, BracketRow[]>();
  for (const b of (bracketsRaw ?? []) as BracketRow[]) {
    const list = bracketsByRule.get(b.fee_rule_id) ?? [];
    list.push(b);
    bracketsByRule.set(b.fee_rule_id, list);
  }

  const nature = (input.business.natureOfBusiness ?? "").toLowerCase().trim();
  const lbtBasis = input.applicationType === "new" ? input.capitalInvestment : input.grossSales;
  const lines: FeeLineResult[] = [];
  const warnings: string[] = [];

  // ---- LBT schedule line ----
  const lbtRule = rules.find((r) => r.fee_category === "lbt" && r.applies_to === input.business.lbtCategory);
  let lbtAmount: number | null = null;
  if (!lbtRule) {
    warnings.push(`No active LBT Schedule rule matches "${input.business.lbtCategory}" — check the category in the Business Registry.`);
  } else if (lbtBasis == null) {
    // Used to hard-block the whole assessment here (return {ok: false}) --
    // changed 2026-08-14 so a missing basis only blocks the Local Business
    // Tax line itself, not Mayor's Permit/regulatory/CEDULA alongside it.
    // Directly needed for "regulatory fees are always included" (the
    // project owner's own words) -- they can't be always-included if one
    // missing figure on a different line took down the entire computation.
    warnings.push(`Missing ${input.applicationType === "new" ? "capital investment" : "gross sales"} — can't compute the business tax without it.`);
  } else {
    const result = computeRuleAmount(lbtRule, bracketsByRule.get(lbtRule.id) ?? [], lbtBasis, null, input.applicationType);
    if (typeof result === "object") warnings.push(result.error);
    else {
      lbtAmount = round2(result);
      lines.push({ feeRuleId: lbtRule.id, feeCategory: "lbt", displayLabel: CATEGORY_LABEL.lbt!, amount: lbtAmount, includedInTotal: lbtRule.delivery_mode === "online", isManualEligible: true, acctCode: lbtRule.acct_code });
    }
  }

  // ---- Essential-commodity discount ----
  if (lbtRule && lbtAmount != null) {
    const discountRule = rules.find((r) => r.fee_category === "discount");
    if (discountRule) {
      const commodityList = (discountRule.applies_to ?? "").split("|").map((s) => s.trim().toLowerCase());
      const targets = discountRule.discount_target_fee_rule_ids ?? [];
      if (commodityList.includes(nature) && targets.includes(lbtRule.id)) {
        const discountAmount = -round2(lbtAmount * (discountRule.percentage_rate ?? 0));
        lines.push({ feeRuleId: discountRule.id, feeCategory: "discount", displayLabel: discountRule.name, amount: discountAmount, includedInTotal: discountRule.delivery_mode === "online", isManualEligible: false, acctCode: discountRule.acct_code });
      }
    }
  }

  // ---- Mayor's Permit line -- named catalog (San Miguel) or tier_matrix (San Ildefonso), never both active at once for one LGU ----
  const mayorsRules = rules.filter((r) => r.fee_category === "mayors_permit");
  const isTierMatrixLgu = mayorsRules.some((r) => r.computation_type === "tier_matrix");

  if (isTierMatrixLgu) {
    const categoryRule = findTierMatrixCategoryRule(mayorsRules, nature);
    if (!categoryRule) {
      warnings.push(`No Mayor's Permit category (including the default) is configured for "${input.business.natureOfBusiness ?? "this business type"}" — assess this line manually.`);
    } else {
      const employeeCount = (input.business.maleEmployeeCount ?? 0) + (input.business.femaleEmployeeCount ?? 0) || null;
      const resolved = resolveSizeTier(input.applicationType, input.capitalInvestment, employeeCount);
      if (!resolved) {
        warnings.push(`"${categoryRule.name}" needs either capital investment or an employee count to determine the business-size tier — assess this line manually.`);
      } else {
        const cell = (bracketsByRule.get(categoryRule.id) ?? []).find((b) => b.tier_label === resolved.tier);
        if (!cell) {
          warnings.push(`"${categoryRule.name}" has no configured amount for the "${resolved.tier}" tier — assess this line manually.`);
        } else {
          const note = resolved.approximated
            ? "Business-size tier estimated from employee count only (no captured current asset value for a renewal) — confirm if the business's actual assets say otherwise."
            : undefined;
          lines.push({ feeRuleId: categoryRule.id, feeCategory: "mayors_permit", displayLabel: CATEGORY_LABEL.mayors_permit!, amount: round2(cell.base_fee), includedInTotal: categoryRule.delivery_mode === "online", note, isManualEligible: true, acctCode: categoryRule.acct_code });
        }
      }
    }
  } else {
    const mayorsRule = findMayorsPermitCatalogRule(rules, nature, input.business.isBranchOffice, input.business.isAircon, input.applicationType);
    if (!mayorsRule) {
      warnings.push(
        `"${input.business.natureOfBusiness ?? "This business type"}" has a Mayor's Permit rate that depends on a detail this application doesn't capture (e.g. which liquor sub-category) — assess this line manually.`
      );
    } else {
      const basis = resolveBasis(mayorsRule, input, lbtBasis, lbtAmount);
      const perUnitCount = resolvePerUnitCount(mayorsRule, input);
      if (mayorsRule.per_unit_field && perUnitCount == null) {
        warnings.push(`"${mayorsRule.name}" needs a count (${mayorsRule.per_unit_field.replace(/_/g, " ")}) this application doesn't capture — assess this line manually.`);
      } else {
        const result = computeRuleAmount(mayorsRule, bracketsByRule.get(mayorsRule.id) ?? [], basis, perUnitCount, input.applicationType);
        if (typeof result === "object") warnings.push(result.error);
        else {
          const note = mayorsRule.basis_field === "preceding_year_lbt_paid" ? "Tier estimated from this year's business tax — confirm if the business's history says otherwise." : undefined;
          lines.push({ feeRuleId: mayorsRule.id, feeCategory: "mayors_permit", displayLabel: CATEGORY_LABEL.mayors_permit!, amount: round2(result), includedInTotal: mayorsRule.delivery_mode === "online", note, isManualEligible: true, acctCode: mayorsRule.acct_code });
        }
      }
    }
  }

  // ---- Regulatory fees -- every active row, unconditionally unless it's category-split (2026-08-14 follow-up) ----
  for (const [name, variants] of groupRegulatoryRules(rules)) {
    // A single row with no applies_to, or applies_to = 'all' (the
    // original seed script's own convention for its dormant "Application
    // Fee" row -- this loop is what finally activates it), is a plain
    // unconditional flat fee (CNC, Plate Fee, ...) -- applies to everyone,
    // no matching needed. Anything else with an applies_to, single row or
    // several, is category-split (Garbage-Fee-shaped) and must actually
    // match this business, same "specific match, else a designated
    // default" rule as Mayor's Permit -- a lone category-specific row
    // with nothing else configured is *not* the same as "matches
    // everyone" (caught by a synthetic test: a manufacturer-only Garbage
    // Fee row was incorrectly charged to a sari-sari store before this
    // fix).
    const isUnconditional = (r: FeeRuleRow) => !r.applies_to || r.applies_to === "all";
    const rule = variants.length === 1 && isUnconditional(variants[0]) ? variants[0] : findTierMatrixCategoryRule(variants, nature);
    if (!rule) {
      warnings.push(`"${name}" has no matching category (including a default) configured for "${input.business.natureOfBusiness ?? "this business type"}" — assess this line manually.`);
      continue;
    }
    const basis = resolveBasis(rule, input, lbtBasis, lbtAmount);
    if (rule.basis_field && basis == null) {
      warnings.push(`"${name}" has no basis amount to compute from — assess this line manually.`);
      continue;
    }
    const result = computeRuleAmount(rule, bracketsByRule.get(rule.id) ?? [], basis, null, input.applicationType);
    if (typeof result === "object") warnings.push(result.error);
    else lines.push({ feeRuleId: rule.id, feeCategory: "regulatory", displayLabel: name, amount: round2(result), includedInTotal: rule.delivery_mode === "online", isManualEligible: rule.computation_type !== "flat", acctCode: rule.acct_code });
  }

  // ---- Barangay Clearance (2026-08-17) ----
  // Only charged when the applicant chose "No, generate my Brgy.
  // clearance" on the application form -- someone who already has their
  // own (uploaded, "Yes") isn't paying MuniServe for a second one. Pre-
  // feature applications where this was never asked (has_barangay_
  // clearance null) aren't affected either.
  //
  // A missing rate here is a WARNING, not a hard {ok:false} block like a
  // missing LBT category -- traced through deliberately, not by default:
  // a hard block gets silently bypassed once Automated Assessment is off
  // (that toggle's own fallback treats ANY blocked result as "fall
  // through to manual entry"), which would let exactly the gap this is
  // meant to catch slip through unnoticed. finalizeAssessment (bplo/
  // actions.ts) has its own direct, toggle-independent guard instead --
  // it refuses to finalize when this line is required but missing,
  // regardless of Automated Assessment's state.
  if (input.business.hasBarangayClearance === "No, generate my Brgy. clearance") {
    const barangayRules = rules.filter((r) => r.fee_category === "barangay_clearance");
    // A specific per-barangay row wins over the uniform "all" fallback --
    // same "specific match, else a designated default" convention as
    // Mayor's Permit's own catalog (findMayorsPermitCatalogRule). Lets an
    // LGU be "mostly uniform, a couple barangays are different" without
    // an all-or-nothing mode switch (see migration 0043's own comment).
    const rule =
      (input.business.barangay ? barangayRules.find((r) => r.applies_to === input.business.barangay) : null) ??
      barangayRules.find((r) => r.applies_to === "all");
    if (!rule) {
      warnings.push(
        input.business.barangay
          ? `No Barangay Clearance rate is configured for "${input.business.barangay}" — set it in Settings before this application can be assessed.`
          : `No Barangay Clearance rate is configured — set it in Settings before this application can be assessed.`
      );
    } else {
      const result = computeRuleAmount(rule, [], null, null, input.applicationType);
      if (typeof result === "object") warnings.push(result.error);
      else lines.push({ feeRuleId: rule.id, feeCategory: "barangay_clearance", displayLabel: CATEGORY_LABEL.barangay_clearance!, amount: round2(result), includedInTotal: rule.delivery_mode === "online", isManualEligible: false, acctCode: rule.acct_code });
    }
  }

  // ---- CEDULA ----
  // Only surfaced at all when this LGU has it set to `online` (Settings,
  // CLAUDE.md 7ff) -- 2026-08-16 same-day follow-up, project owner's own
  // direct call after seeing it live: a reference_only line still showing
  // its amount (excluded from `total` but visible in `lines`, same
  // pattern every reference_only regulatory fee already used) read as
  // confusing rather than informative once CEDULA specifically had a
  // live Settings toggle to turn it off. Treasury computes their own
  // counter amount independently either way -- this was only ever a
  // preview, not something downstream depends on.
  const isIndividual = (input.business.organizationType ?? "").toLowerCase() === "sole proprietorship";
  const cedulaRule = rules.find((r) => r.fee_category === "cedula" && r.applies_to === (isIndividual ? "individual" : "juridical"));
  if (!cedulaRule) {
    // A genuine config gap (missing/deactivated row), not the reference_only
    // case below -- still worth flagging, since it's an onboarding bug this
    // Settings toggle isn't meant to silence.
    warnings.push("No active CEDULA rule found for this organization type.");
  } else if (cedulaRule.delivery_mode === "online") {
    if (lbtBasis == null) {
      warnings.push("CEDULA needs a basis amount this application doesn't have — assess it manually.");
    } else {
      const result = computeRuleAmount(cedulaRule, [], lbtBasis, null, input.applicationType);
      if (typeof result === "object") warnings.push(result.error);
      else lines.push({ feeRuleId: cedulaRule.id, feeCategory: "cedula", displayLabel: cedulaRule.name, amount: round2(result), includedInTotal: true, isManualEligible: false, acctCode: cedulaRule.acct_code });
    }
  }
  // else: reference_only -- intentionally not surfaced here at all (see comment above).

  const total = round2(lines.filter((l) => l.includedInTotal).reduce((sum, l) => sum + l.amount, 0));
  return { ok: true, lines, total, warnings };
}
