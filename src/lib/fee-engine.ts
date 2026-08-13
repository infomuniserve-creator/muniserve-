/**
 * Fee computation engine (build order step 7). Reads an LGU's active
 * `fee_rules`/`fee_rule_brackets` and computes what one application owes,
 * matching CLAUDE.md section 7a's documented conventions (from the seed
 * script's own header, confirmed against the live database while
 * building this rather than re-guessed):
 *
 *   - `basis_field = 'lbt_basis'` is computed, not a column: capital
 *     investment for a new application, gross sales for a renewal.
 *   - `fee_rule_brackets.max_amount` is inclusive-min/exclusive-max:
 *     a basis lands in the bracket where `min_amount <= basis < max_amount`.
 *   - `applies_to` uses `key:variant` (e.g. `'commercial bank:branch'`)
 *     for rows gated on `is_branch_office`/`is_aircon`, and
 *     `'standard:new'`/`'standard:renewal'` as the Mayor's Permit
 *     fallback when no business-type-specific rule matches.
 *   - The essential-commodity discount's `applies_to` is a `|`-piped list
 *     (the column isn't an array) naming nature-of-business values, and
 *     it targets specific LBT Schedule rules via
 *     `discount_target_fee_rule_ids`.
 *   - CEDULA (`formula_increment`) is matched by `organization_type`
 *     (`applies_to = 'individual'` for Sole Proprietorship, `'juridical'`
 *     for everything else) and marked `delivery_mode = 'reference_only'`
 *     -- computed and shown, but not part of the online-collected total
 *     (CLAUDE.md rule #11) -- so it never adds into `total`.
 *
 * Every application computes at most four lines: the LBT schedule line
 * (via `businesses.lbt_category`), the essential-commodity discount (if
 * the business's nature-of-business qualifies), the Mayor's Permit line
 * (a business-type-specific rule, or the standard fallback), and the
 * CEDULA line. The other ~110 active rules aren't special-cased
 * individually -- they're all candidates for that one Mayor's Permit
 * slot, distinguished only by which `applies_to` key matches this
 * business's nature of business.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type FeeLineResult = {
  feeRuleId: string;
  feeRuleName: string;
  amount: number; // negative for the discount line
  includedInTotal: boolean; // false for reference_only rules like CEDULA
  note?: string; // shown to BPLO -- e.g. "estimated, please confirm"
};

export type FeeComputationResult =
  | { ok: true; lines: FeeLineResult[]; total: number; warnings: string[] }
  | { ok: false; blockedReason: string };

type FeeRuleRow = {
  id: string;
  name: string;
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
};

type BracketRow = {
  fee_rule_id: string;
  min_amount: number;
  max_amount: number | null;
  base_fee: number;
  rate: number;
  rate_basis: "excess_over_min" | "full_amount" | null;
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
  };
  /** This year's basis-driven line, when already known, gives the "prior
   * year LBT paid" tier used by the Standard Renewal Mayor's Permit fee
   * something to go on for a business with no MuniServe history yet --
   * see computeApplicationFees's note on this below. */
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function bracketFor(basis: number, brackets: BracketRow[]): BracketRow | null {
  const sorted = [...brackets].sort((a, b) => a.sort_order - b.sort_order);
  return sorted.find((b) => basis >= b.min_amount && (b.max_amount == null || basis < b.max_amount)) ?? null;
}

function bracketAmount(basis: number, bracket: BracketRow): number {
  if (bracket.rate_basis === "full_amount") return bracket.base_fee + bracket.rate * basis;
  return bracket.base_fee + bracket.rate * (basis - bracket.min_amount);
}

/** flat / per_unit / tiered / tiered_percentage / flat_percentage / formula_increment -- discount_subset is handled separately since it references other lines, not a basis. */
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
      // New applications on an LBT schedule use a flat rate off capital
      // investment instead of the bracket table, floored at the
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
      // businesses, the generic (free-text) one otherwise.
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

/** Finds the Mayor's Permit rule for this business: a specific business-type match first (resolving :branch/:aircon variants), the standard:new/standard:renewal fallback otherwise. */
function findMayorsPermitRule(rules: FeeRuleRow[], nature: string, isBranchOffice: boolean | null, isAircon: boolean | null, applicationType: "new" | "renewal"): FeeRuleRow | null {
  const isLbtOrCedulaOrDiscount = (r: FeeRuleRow) => r.name.startsWith("LBT Schedule") || r.computation_type === "formula_increment" || r.computation_type === "discount_subset";
  const candidates = rules.filter((r) => !isLbtOrCedulaOrDiscount(r) && r.applies_to);

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

  return rules.find((r) => r.applies_to === `standard:${applicationType}`) ?? null;
}

export async function computeApplicationFees(supabase: SupabaseClient, input: FeeComputationInput): Promise<FeeComputationResult> {
  if (!input.business.lbtCategory) {
    return { ok: false, blockedReason: "This business has no LBT category set yet. Set it in the Business Registry before this application can be assessed." };
  }

  const { data: rulesRaw, error: rulesError } = await supabase
    .from("fee_rules")
    .select(
      "id, name, computation_type, applies_to, basis_field, flat_amount, per_unit_rate, per_unit_field, percentage_rate, formula_base_fee, formula_increment_amount, formula_increment_per, formula_cap, discount_target_fee_rule_ids, new_business_rate, delivery_mode"
    )
    .eq("lgu_id", input.lguId)
    .eq("is_active", true);
  if (rulesError) return { ok: false, blockedReason: `Could not load fee rules: ${rulesError.message}` };
  const rules = (rulesRaw ?? []) as FeeRuleRow[];

  const { data: bracketsRaw, error: bracketsError } = await supabase
    .from("fee_rule_brackets")
    .select("fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, sort_order")
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
  const lbtRule = rules.find((r) => r.name.startsWith("LBT Schedule") && r.applies_to === input.business.lbtCategory);
  let lbtAmount: number | null = null;
  if (!lbtRule) {
    warnings.push(`No active LBT Schedule rule matches "${input.business.lbtCategory}" — check the category in the Business Registry.`);
  } else if (lbtBasis == null) {
    return {
      ok: false,
      blockedReason: `Missing ${input.applicationType === "new" ? "capital investment" : "gross sales"} — can't compute the business tax without it.`,
    };
  } else {
    const result = computeRuleAmount(lbtRule, bracketsByRule.get(lbtRule.id) ?? [], lbtBasis, null, input.applicationType);
    if (typeof result === "object") warnings.push(result.error);
    else {
      lbtAmount = round2(result);
      lines.push({ feeRuleId: lbtRule.id, feeRuleName: lbtRule.name, amount: lbtAmount, includedInTotal: lbtRule.delivery_mode === "online" });
    }
  }

  // ---- Essential-commodity discount ----
  if (lbtRule && lbtAmount != null) {
    const discountRule = rules.find((r) => r.computation_type === "discount_subset");
    if (discountRule) {
      const commodityList = (discountRule.applies_to ?? "").split("|").map((s) => s.trim().toLowerCase());
      const targets = discountRule.discount_target_fee_rule_ids ?? [];
      if (commodityList.includes(nature) && targets.includes(lbtRule.id)) {
        const discountAmount = -round2(lbtAmount * (discountRule.percentage_rate ?? 0));
        lines.push({ feeRuleId: discountRule.id, feeRuleName: discountRule.name, amount: discountAmount, includedInTotal: discountRule.delivery_mode === "online" });
      }
    }
  }

  // ---- Mayor's Permit line (business-type-specific, or standard fallback) ----
  const mayorsRule = findMayorsPermitRule(rules, nature, input.business.isBranchOffice, input.business.isAircon, input.applicationType);
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
        lines.push({ feeRuleId: mayorsRule.id, feeRuleName: mayorsRule.name, amount: round2(result), includedInTotal: mayorsRule.delivery_mode === "online", note });
      }
    }
  }

  // ---- CEDULA ----
  const isIndividual = (input.business.organizationType ?? "").toLowerCase() === "sole proprietorship";
  const cedulaRule = rules.find((r) => r.computation_type === "formula_increment" && r.applies_to === (isIndividual ? "individual" : "juridical"));
  if (!cedulaRule) {
    warnings.push("No active CEDULA rule found for this organization type.");
  } else if (lbtBasis == null) {
    warnings.push("CEDULA needs a basis amount this application doesn't have — assess it manually.");
  } else {
    const result = computeRuleAmount(cedulaRule, [], lbtBasis, null, input.applicationType);
    if (typeof result === "object") warnings.push(result.error);
    else lines.push({ feeRuleId: cedulaRule.id, feeRuleName: cedulaRule.name, amount: round2(result), includedInTotal: cedulaRule.delivery_mode === "online" });
  }

  const total = round2(lines.filter((l) => l.includedInTotal).reduce((sum, l) => sum + l.amount, 0));
  return { ok: true, lines, total, warnings };
}
