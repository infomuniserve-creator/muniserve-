"use server";

import { getCurrentStaff } from "@/lib/staff";
import { openDepartmentReviewRound } from "@/lib/review-workflow";
import { normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * BPLO files a renewal (or a new/reactivation permit) on behalf of a
 * walk-in owner -- the counter-transaction case from the Business
 * Registry design discussion, for someone who shows up in person instead
 * of using the phone-OTP flow themselves. Deliberately minimal compared
 * to the applicant wizard: it doesn't re-collect the ~40-field profile
 * (already on file for every business the registry lists, and editing it
 * is explicitly out of scope for this feature) -- just the one figure
 * that actually changes year to year.
 *
 * Skips pending_bplo_initial and opens the department round immediately
 * -- BPLO is standing at the counter vouching for the physical documents
 * right now, so there's no separate "initial review" left to do.
 * initial_review_* is still recorded, pre-filled as approved, for the
 * same audit trail every other path through this workflow leaves.
 *
 * The phone number is optional. If given, it claims the business exactly
 * like the self-service legacy-claim flow does (find-or-create an owners
 * row, link it) -- without that, a legacy-unclaimed business stays
 * unclaimed even after this filing, since there'd otherwise be no way
 * for the real owner to ever look up their own status by SMS. See
 * business-status.ts for how that interacts with the registry's status
 * classification.
 */
export async function startWalkInApplication(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const businessId = String(formData.get("businessId") ?? "");
  const applicationType = String(formData.get("applicationType") ?? "");
  const amount = Number(formData.get("amount"));
  const phoneInput = String(formData.get("phone") ?? "").trim();

  if (!businessId || (applicationType !== "new" && applicationType !== "renewal") || !amount || amount <= 0) {
    throw new Error("Invalid walk-in application");
  }

  const supabase = await createClient();
  const year = new Date().getFullYear();

  const { data: business, error: fetchError } = await supabase
    .from("businesses")
    .select("gross_sales_history, is_legacy_unclaimed, owner_id, legacy_owner_name")
    .eq("id", businessId)
    .single();
  if (fetchError || !business) throw fetchError ?? new Error("Business not found");

  const businessUpdate: Record<string, unknown> = {};

  if (applicationType === "renewal") {
    const history = (business.gross_sales_history as Record<string, number> | null) ?? {};
    history[String(year)] = amount;
    businessUpdate.gross_sales_history = history;
  } else {
    // Reactivating a closed business, or filing a first-ever permit for a
    // legacy record that was imported without one.
    businessUpdate.is_active = true;
  }

  if (phoneInput) {
    const phone = normalizePhone(phoneInput);
    if (!phone) throw new Error("That mobile number doesn't look right -- check it and try again.");

    const { data: existingOwner } = await supabase.from("owners").select("id").eq("phone", phone).maybeSingle();
    let ownerId = existingOwner?.id ?? business.owner_id ?? null;
    if (!ownerId) {
      const { data: newOwner, error: ownerError } = await supabase
        .from("owners")
        .insert({ full_name: business.legacy_owner_name || phone, phone, claimed_at: new Date().toISOString() })
        .select("id")
        .single();
      if (ownerError || !newOwner) throw ownerError ?? new Error("Owner create failed");
      ownerId = newOwner.id;
    }
    businessUpdate.owner_id = ownerId;
    if (business.is_legacy_unclaimed) businessUpdate.is_legacy_unclaimed = false;
  }

  if (Object.keys(businessUpdate).length > 0) {
    const { error: updateError } = await supabase.from("businesses").update(businessUpdate).eq("id", businessId);
    if (updateError) throw updateError;
  }

  const { data: referenceNumber, error: refError } = await supabase.rpc("generate_application_reference", {
    p_lgu_id: staff.lgu_id,
    p_year: year,
  });
  if (refError || !referenceNumber) throw refError ?? new Error("Reference generation failed");

  const formInputs =
    applicationType === "new"
      ? { capital_investment: amount, gross_sales: null }
      : { capital_investment: null, gross_sales: amount };

  const { data: application, error: appError } = await supabase
    .from("applications")
    .insert({
      lgu_id: staff.lgu_id,
      business_id: businessId,
      application_type: applicationType,
      application_year: year,
      status: "pending_dept_review",
      form_inputs: formInputs,
      reference_number: referenceNumber,
      declaration_accepted_at: new Date().toISOString(),
      initial_review_decision: "approved",
      initial_review_notes: "Filed in person at the BPLO counter — documents verified on the spot.",
      initial_review_by: staff.id,
      initial_review_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (appError || !application) throw appError ?? new Error("Application create failed");

  await openDepartmentReviewRound(supabase, application.id, staff.lgu_id);

  revalidatePath("/dashboard/businesses");
  revalidatePath("/dashboard/bplo");
}
