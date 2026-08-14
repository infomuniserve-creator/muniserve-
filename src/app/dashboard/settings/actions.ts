"use server";

import { getCurrentStaff } from "@/lib/staff";
import { actorLabelFor, logAuditEvent } from "@/lib/audit-log";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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
