"use server";

import { getCurrentStaff } from "@/lib/staff";
import { actorLabelFor, logAuditEvent } from "@/lib/audit-log";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { type FeeType, parseLbtCsv, parseMayorsPermitCsv, summarizeRule } from "@/lib/fee-rule-import";

/**
 * Regulatory Fees manager (2026-08-14 follow-up) -- flat, LGU-specific
 * fees (CNC, Health Permit Fee, Inspection Fee, Plate Fee, Regulatory Fee,
 * Sanitary Fee, or anything else a BPLO wants to add) that get included in
 * every assessment unconditionally, per the project owner's own words
 * ("it always is included, and it must be listed"). Each one is just a
 * `fee_rules` row (`fee_category = 'regulatory'`, `computation_type =
 * 'flat'`) -- reuses the exact table every other fee already lives in
 * (rule #1: never hardcode a fee, it's always a per-LGU database row)
 * rather than inventing a parallel mechanism. `fee-engine.ts`'s regulatory
 * loop picks up every active row here automatically -- no engine change
 * needed to add a new one.
 *
 * Graduated/category-split regulatory fees (a Garbage-Fee-shaped fee that
 * varies by floor area and business type, discovered analyzing a second
 * LGU's actual revenue code) are supported by the engine already, but not
 * by this UI yet -- flat only, matching what was actually asked for here.
 * Onboarding a graduated regulatory fee still goes through a migration for
 * now; see CLAUDE.md for the full scope note.
 */
export async function addRegulatoryFee(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const name = String(formData.get("name") ?? "").trim();
  const amount = Number(formData.get("amount"));
  const deliveryMode = String(formData.get("deliveryMode") ?? "online");
  if (!name || !Number.isFinite(amount) || amount < 0) throw new Error("Enter a fee name and a valid amount.");
  if (deliveryMode !== "online" && deliveryMode !== "reference_only") throw new Error("Invalid delivery mode.");

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("fee_rules")
    .select("sort_order")
    .eq("lgu_id", staff.lgu_id)
    .eq("fee_category", "regulatory")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = (existing?.sort_order ?? 300) + 1;

  const { error } = await supabase.from("fee_rules").insert({
    lgu_id: staff.lgu_id,
    name,
    fee_category: "regulatory",
    computation_type: "flat",
    flat_amount: amount,
    delivery_mode: deliveryMode,
    is_active: true,
    sort_order: nextSortOrder,
  });
  if (error) throw error;

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "regulatory_fee_added",
    summary: `Added regulatory fee "${name}" (₱${amount.toLocaleString()}${deliveryMode === "reference_only" ? ", paid at the counter" : ""})`,
    details: { name, amount, deliveryMode },
  });

  revalidatePath("/dashboard/settings");
}

/** Soft-delete only, matching this schema's standing convention (businesses.is_active, lgu_departments.is_active, staff_users.is_active) -- a fee already charged on a past assessment must keep showing correctly on that historical record, which a hard delete would silently corrupt. */
export async function setRegulatoryFeeActive(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const feeRuleId = String(formData.get("feeRuleId"));
  const isActive = formData.get("isActive") === "true";

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("fee_rules")
    .update({ is_active: isActive })
    .eq("id", feeRuleId)
    .eq("lgu_id", staff.lgu_id)
    .eq("fee_category", "regulatory")
    .select("name")
    .single();
  if (error || !updated) throw error ?? new Error("Fee not found");

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "regulatory_fee_updated",
    summary: `${isActive ? "Reactivated" : "Deactivated"} regulatory fee "${updated.name}"`,
  });

  revalidatePath("/dashboard/settings");
}

/**
 * The "safe place to go if whatever we design fails" (the project
 * owner's own framing, 2026-08-14). Off means the assessment card falls
 * back to hand-entered amounts for Local Business Tax, Mayor's Permit
 * Fee, and any graduated regulatory fee (finalizeAssessment in
 * bplo/actions.ts is what actually branches on this) -- flat fees and
 * CEDULA are unaffected either way, since there's nothing in a flat
 * number a bracket/matrix lookup can get wrong.
 */
export async function setAutomatedAssessmentEnabled(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const enabled = formData.get("enabled") === "true";

  const supabase = await createClient();
  const { error } = await supabase.from("lgus").update({ automated_assessment_enabled: enabled }).eq("id", staff.lgu_id);
  if (error) throw error;

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: enabled ? "automated_assessment_enabled" : "automated_assessment_disabled",
    summary: enabled
      ? "Automated Assessment turned back on -- Local Business Tax and Mayor's Permit Fee compute automatically again"
      : "Automated Assessment turned off -- Local Business Tax and Mayor's Permit Fee now require manual entry on every assessment",
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/bplo");
}

/**
 * Sets the Mayor's name shown on the pre-signature print certificate
 * (CLAUDE.md 7x, print-certificate.ts) -- migration 0033's lgus.mayor_name.
 * No generic fallback exists for a person's actual name (unlike
 * bplo_office_name), so this stays blank on the certificate's signature
 * block until BPLO fills it in here. Same "RLS bounds rows, not columns"
 * convention as setAutomatedAssessmentEnabled -- reuses migration 0027's
 * existing "bplo can update their own lgu's settings" policy, no new
 * migration needed for this control.
 */
export async function updateMayorName(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const mayorName = String(formData.get("mayorName") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("lgus").update({ mayor_name: mayorName }).eq("id", staff.lgu_id);
  if (error) throw error;

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "mayor_name_updated",
    summary: mayorName ? `Mayor's name set to "${mayorName}" for the print certificate` : "Mayor's name cleared",
  });

  revalidatePath("/dashboard/settings");
}

/**
 * Turns the Engineering-assessed Building Permit Fee on/off, and sets its
 * display label (CLAUDE.md 7aa) -- migration 0035's lgus.building_permit_
 * fee_enabled/building_permit_fee_label. Off by default: no LGU sees the
 * amount field on Engineering's review until BPLO deliberately turns this
 * on. Same "RLS bounds rows, not columns" convention as updateMayorName
 * -- reuses migration 0027's existing lgus UPDATE policy, no new
 * migration needed for this control itself.
 */
export async function updateBuildingPermitFeeSettings(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const enabled = formData.get("enabled") === "true";
  const label = String(formData.get("label") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("lgus").update({ building_permit_fee_enabled: enabled, building_permit_fee_label: label }).eq("id", staff.lgu_id);
  if (error) throw error;

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "building_permit_fee_updated",
    summary: `${label ?? "Building Permit Fee"} ${enabled ? "turned on" : "turned off"} for Engineering's review`,
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/bplo");
  revalidatePath("/dashboard/department");
}

// ============================================================
// Business Tax & Mayor's Permit Fee Setup -- CSV import (2026-08-15)
//
// Replaces the old "a developer writes SQL directly against the database"
// onboarding step with a reviewable file upload. See src/lib/fee-rule-import.ts
// for the parsing/validation logic and CLAUDE.md's onboarding-scalability
// discussion for why this is scoped the way it is.
// ============================================================

export type FeeImportPreview = { ok: true; summaries: string[]; warnings: string[]; ruleCount: number } | { ok: false; errors: string[] };

/** Parse-only, no writes -- lets BPLO see exactly what a file will do before committing to it. */
export async function previewFeeRuleImport(feeType: FeeType, csvText: string): Promise<FeeImportPreview> {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const result = feeType === "lbt" ? parseLbtCsv(csvText) : parseMayorsPermitCsv(csvText);
  if (!result.ok) return { ok: false, errors: result.errors };
  return { ok: true, summaries: result.rules.map(summarizeRule), warnings: result.warnings, ruleCount: result.rules.length };
}

/**
 * Re-parses the same file server-side rather than trusting whatever the
 * client's preview state says -- same reasoning as finalizeAssessment in
 * bplo/actions.ts ("never trusts the page's own preview, re-runs
 * computation server-side"): a form field is technically client-editable,
 * so the only trustworthy copy of "what does this file actually contain"
 * is a fresh parse of the file bytes themselves.
 *
 * Deactivates the fee category's currently-active rules only *after* every
 * new rule+bracket insert has succeeded -- if an insert fails partway, the
 * old rules are never touched (still fully live) and whatever new rows did
 * get inserted this run are deleted again, so a failed upload can't leave
 * this LGU's assessments half-covered by old rules and half by a broken
 * new set. Not a real database transaction (supabase-js has no multi-
 * statement transaction API against PostgREST), but bounds the failure mode
 * to "nothing changed" rather than "changed and broken".
 */
export async function publishFeeRuleImport(feeType: FeeType, csvText: string): Promise<{ ok: true; ruleCount: number } | { ok: false; errors: string[] }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const result = feeType === "lbt" ? parseLbtCsv(csvText) : parseMayorsPermitCsv(csvText);
  if (!result.ok) return { ok: false, errors: result.errors };

  const supabase = await createClient();
  const feeCategory = feeType === "lbt" ? "lbt" : "mayors_permit";

  const { data: previouslyActive, error: fetchError } = await supabase
    .from("fee_rules")
    .select("id")
    .eq("lgu_id", staff.lgu_id)
    .eq("fee_category", feeCategory)
    .eq("is_active", true);
  if (fetchError) return { ok: false, errors: [fetchError.message] };

  const insertedRuleIds: string[] = [];
  try {
    for (const rule of result.rules) {
      const { data: inserted, error: ruleError } = await supabase
        .from("fee_rules")
        .insert({
          lgu_id: staff.lgu_id,
          fee_category: feeCategory,
          name: rule.name,
          computation_type: rule.computationType,
          applies_to: rule.appliesTo,
          basis_field: feeType === "lbt" ? "lbt_basis" : null,
          flat_amount: rule.flatAmount,
          per_unit_rate: rule.perUnitRate,
          per_unit_field: rule.perUnitField,
          new_business_rate: rule.newBusinessRate,
          delivery_mode: rule.deliveryMode,
          is_active: true,
          sort_order: 300 + insertedRuleIds.length,
        })
        .select("id")
        .single();
      if (ruleError || !inserted) throw new Error(ruleError?.message ?? "Insert failed");
      insertedRuleIds.push(inserted.id);

      const bracketRows: { fee_rule_id: string; min_amount: number | null; max_amount: number | null; base_fee: number; rate: number; rate_basis: "excess_over_min" | "full_amount"; tier_label: string | null; sort_order: number }[] =
        rule.computationType === "tier_matrix"
          ? rule.tierCells.map((cell, i) => ({ fee_rule_id: inserted.id, min_amount: null, max_amount: null, base_fee: cell.amount, rate: 0, rate_basis: "excess_over_min", tier_label: cell.tierLabel, sort_order: i }))
          : rule.brackets.map((b, i) => ({ fee_rule_id: inserted.id, min_amount: b.minAmount, max_amount: b.maxAmount, base_fee: b.baseFee, rate: b.rate, rate_basis: b.rateBasis, tier_label: null, sort_order: i }));
      if (bracketRows.length > 0) {
        const { error: bracketError } = await supabase.from("fee_rule_brackets").insert(bracketRows);
        if (bracketError) throw new Error(bracketError.message);
      }
    }
  } catch (err) {
    if (insertedRuleIds.length > 0) await supabase.from("fee_rules").delete().in("id", insertedRuleIds);
    return { ok: false, errors: [`Nothing was changed -- upload failed partway through: ${err instanceof Error ? err.message : String(err)}`] };
  }

  const idsToDeactivate = (previouslyActive ?? []).map((r) => r.id);
  if (idsToDeactivate.length > 0) {
    const { error: deactivateError } = await supabase.from("fee_rules").update({ is_active: false }).in("id", idsToDeactivate);
    if (deactivateError) return { ok: false, errors: [`New rates were added but the old ones couldn't be deactivated: ${deactivateError.message}. Contact support -- both sets are currently active.`] };
  }

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: feeType === "lbt" ? "lbt_rates_imported" : "mayors_permit_rates_imported",
    summary: `${feeType === "lbt" ? "Local Business Tax" : "Mayor's Permit Fee"} rates updated via CSV import (${result.rules.length} rule${result.rules.length === 1 ? "" : "s"}, replacing ${idsToDeactivate.length} previous rule${idsToDeactivate.length === 1 ? "" : "s"})`,
    details: { feeType, ruleCount: result.rules.length, deactivatedCount: idsToDeactivate.length },
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/bplo");
  return { ok: true, ruleCount: result.rules.length };
}

type ExportBracketRow = { fee_rule_id: string; min_amount: number | null; max_amount: number | null; base_fee: number; rate: number; rate_basis: "excess_over_min" | "full_amount"; tier_label: string | null; sort_order: number };

/** Used by the template-download route handler -- fetches this LGU's currently active rules of one fee category, shaped for fee-rule-import.ts's CSV builders. Kept here (not the route handler) since it needs the same staff-auth + RLS-scoped client every other settings action uses. */
export async function getExportableFeeRules(feeType: FeeType): Promise<{ lbt: import("@/lib/fee-rule-import").ExportableLbtRule[] } | { mp: import("@/lib/fee-rule-import").ExportableMpRule[] }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const supabase = await createClient();
  const feeCategory = feeType === "lbt" ? "lbt" : "mayors_permit";
  const { data: rules, error } = await supabase
    .from("fee_rules")
    .select("id, name, computation_type, applies_to, new_business_rate, flat_amount, per_unit_rate, per_unit_field, delivery_mode, sort_order")
    .eq("lgu_id", staff.lgu_id)
    .eq("fee_category", feeCategory)
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;

  const ruleIds = (rules ?? []).map((r) => r.id);
  const { data: brackets, error: bracketsError } = ruleIds.length
    ? await supabase
        .from("fee_rule_brackets")
        .select("fee_rule_id, min_amount, max_amount, base_fee, rate, rate_basis, tier_label, sort_order")
        .in("fee_rule_id", ruleIds)
        .order("sort_order")
    : { data: [] as ExportBracketRow[], error: null };
  if (bracketsError) throw bracketsError;
  const bracketsByRule = new Map<string, ExportBracketRow[]>();
  for (const b of (brackets ?? []) as ExportBracketRow[]) {
    const list = bracketsByRule.get(b.fee_rule_id) ?? [];
    list.push(b);
    bracketsByRule.set(b.fee_rule_id, list);
  }

  if (feeType === "lbt") {
    const lbt = (rules ?? []).map((r) => ({
      name: r.name,
      appliesTo: r.applies_to ?? "",
      newBusinessRate: r.new_business_rate,
      deliveryMode: r.delivery_mode,
      brackets: (bracketsByRule.get(r.id) ?? []).map((b) => ({ minAmount: b.min_amount, maxAmount: b.max_amount, baseFee: Number(b.base_fee), rate: Number(b.rate), rateBasis: b.rate_basis })),
    }));
    return { lbt };
  }
  const mp = (rules ?? []).map((r) => ({
    name: r.name,
    computationType: r.computation_type,
    appliesTo: r.applies_to,
    flatAmount: r.flat_amount,
    perUnitRate: r.per_unit_rate,
    perUnitField: r.per_unit_field,
    deliveryMode: r.delivery_mode,
    tierCells: (bracketsByRule.get(r.id) ?? []).filter((b) => b.tier_label).map((b) => ({ tierLabel: b.tier_label as string, amount: Number(b.base_fee) })),
  }));
  return { mp };
}
