"use server";

import { getCurrentStaff } from "@/lib/staff";
import { openDepartmentReviewRound } from "@/lib/review-workflow";
import { computeApplicationFees } from "@/lib/fee-engine";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

type Decision = "approved" | "approved_with_condition" | "request_more_info" | "rejected";

/**
 * BPLO's initial legitimacy review (state machine: pending_bplo_initial ->
 * pending_dept_review or returned_to_applicant). Uses BPLO's own
 * RLS-scoped session for the applications UPDATE (the existing "bplo can
 * update applications at their own lgu" policy from migration 0002
 * already covers this -- no service-role needed there) and for creating
 * the review_rounds/department_reviews rows (migration 0008's new INSERT
 * policy + the existing bplo department_reviews policy). Every active
 * department gets fanned out to at once (rule #4) -- including BFP, which
 * reviews in the same parallel round as everyone else and simply won't
 * approve until it separately sees proof of payment (CLAUDE.md section 7c).
 */
export async function submitInitialReview(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const applicationId = String(formData.get("applicationId"));
  const decision = String(formData.get("decision")) as Decision;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const supabase = await createClient();

  const newStatus =
    decision === "approved" || decision === "approved_with_condition"
      ? "pending_dept_review"
      : "returned_to_applicant";

  const { error: updateError } = await supabase
    .from("applications")
    .update({
      status: newStatus,
      initial_review_decision: decision,
      initial_review_notes: notes,
      initial_review_by: staff.id,
      initial_review_at: new Date().toISOString(),
    })
    .eq("id", applicationId)
    .eq("status", "pending_bplo_initial");
  if (updateError) throw updateError;

  if (newStatus === "pending_dept_review") {
    await openDepartmentReviewRound(supabase, applicationId, staff.lgu_id);
  }

  revalidatePath("/dashboard/bplo");
}

/**
 * BPLO manually confirms an applicant has resubmitted corrections and
 * notifies only the department(s) that flagged an issue (rule #6) -- a
 * new review round with fresh pending rows for just those departments.
 * Departments that already approved in an earlier round aren't touched;
 * their approval keeps counting via areAllDepartmentsCleared's
 * latest-decision-across-rounds logic.
 */
export async function resubmitToDepartments(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const applicationId = String(formData.get("applicationId"));
  const departments = formData.getAll("departments").map(String);
  if (departments.length === 0) return;

  const supabase = await createClient();

  const { data: rounds } = await supabase
    .from("review_rounds")
    .select("round_number")
    .eq("application_id", applicationId)
    .order("round_number", { ascending: false })
    .limit(1);
  const nextRoundNumber = (rounds?.[0]?.round_number ?? 0) + 1;

  const { data: round, error: roundError } = await supabase
    .from("review_rounds")
    .insert({ application_id: applicationId, round_number: nextRoundNumber })
    .select("id")
    .single();
  if (roundError || !round) throw roundError ?? new Error("Failed to create review round");

  const { error: insertError } = await supabase
    .from("department_reviews")
    .insert(departments.map((department) => ({ review_round_id: round.id, department, decision: "pending" })));
  if (insertError) throw insertError;

  revalidatePath("/dashboard/bplo");
}

/**
 * Finalizes the fee assessment (pending_bplo_assessment -> pending_payment).
 * Build order step 7's fee engine (src/lib/fee-engine.ts) computes the
 * lines; this action re-runs it server-side rather than trusting anything
 * the form posts back (the page's own preview -- computeApplicationFees
 * called again below, not read from hidden fields -- is what BPLO actually
 * saw, but a client could in principle edit hidden inputs, so only the
 * override_<feeRuleId>/overrideReason_<feeRuleId> fields, the ones meant
 * to be edited, are trusted from the request).
 *
 * Uses BPLO's own RLS-scoped session to read fee_rules/fee_rule_brackets/
 * businesses/applications (all already staff-readable); service role only
 * for the application_fee_lines INSERT, since there's no staff insert
 * policy on it at all -- computing/recording the assessment is a system
 * step, not something any role has direct write rights to on their own
 * (rule #7: only BPLO can *override* a line, via overridden_amount, which
 * this does write with the acting BPLO's own staff.id).
 */
export async function finalizeAssessment(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const applicationId = String(formData.get("applicationId"));
  const supabase = await createClient();

  const { data: application, error: fetchError } = await supabase
    .from("applications")
    .select(
      `application_type, form_inputs, business:businesses(nature_of_business, lbt_category, organization_type, is_branch_office, is_aircon, seating_capacity, lodger_count, land_area_hectares, warehouse_floor_area_sqm, total_floor_area_sqm, billiard_table_count, guard_post_count, animal_count)`
    )
    .eq("id", applicationId)
    .eq("status", "pending_bplo_assessment")
    .single();
  if (fetchError || !application) throw fetchError ?? new Error("Application not found or not awaiting assessment");

  const business = application.business as unknown as {
    nature_of_business: string | null;
    lbt_category: string | null;
    organization_type: string | null;
    is_branch_office: boolean | null;
    is_aircon: boolean | null;
    seating_capacity: number | null;
    lodger_count: number | null;
    land_area_hectares: number | null;
    warehouse_floor_area_sqm: number | null;
    total_floor_area_sqm: string | null;
    billiard_table_count: number | null;
    guard_post_count: number | null;
    animal_count: number | null;
  } | null;
  if (!business) throw new Error("Business record missing");

  const formInputs = application.form_inputs as { capital_investment?: number | null; gross_sales?: number | null } | null;

  const result = await computeApplicationFees(supabase, {
    lguId: staff.lgu_id,
    applicationType: application.application_type as "new" | "renewal",
    capitalInvestment: formInputs?.capital_investment ?? null,
    grossSales: formInputs?.gross_sales ?? null,
    business: {
      natureOfBusiness: business.nature_of_business,
      lbtCategory: business.lbt_category,
      organizationType: business.organization_type,
      isBranchOffice: business.is_branch_office,
      isAircon: business.is_aircon,
      seatingCapacity: business.seating_capacity,
      lodgerCount: business.lodger_count,
      landAreaHectares: business.land_area_hectares,
      warehouseFloorAreaSqm: business.warehouse_floor_area_sqm,
      totalFloorAreaSqm: business.total_floor_area_sqm,
      billiardTableCount: business.billiard_table_count,
      guardPostCount: business.guard_post_count,
      animalCount: business.animal_count,
    },
  });
  if (!result.ok) throw new Error(result.blockedReason);

  const lineRows = result.lines.map((line) => {
    const overrideRaw = String(formData.get(`override_${line.feeRuleId}`) ?? "").trim();
    const overriddenAmount = overrideRaw !== "" ? Number(overrideRaw) : null;
    const overrideReason = overriddenAmount != null ? String(formData.get(`overrideReason_${line.feeRuleId}`) ?? "").trim() || null : null;
    return {
      application_id: applicationId,
      fee_rule_id: line.feeRuleId,
      computed_amount: line.amount,
      overridden_amount: overriddenAmount,
      override_reason: overrideReason,
      overridden_by: overriddenAmount != null ? staff.id : null,
      overridden_at: overriddenAmount != null ? new Date().toISOString() : null,
      included_in_total: line.includedInTotal,
    };
  });

  const service = createServiceClient();
  if (lineRows.length > 0) {
    const { error: insertError } = await service.from("application_fee_lines").insert(lineRows);
    if (insertError) throw insertError;
  }

  const { error: statusError } = await service
    .from("applications")
    .update({ status: "pending_payment" })
    .eq("id", applicationId)
    .eq("status", "pending_bplo_assessment");
  if (statusError) throw statusError;

  revalidatePath("/dashboard/bplo");
  revalidatePath("/dashboard/treasury");
}

/** BPLO can act on any department's behalf (rule #9) -- same shape as a department's own decision, tagged acted_on_behalf. */
export async function submitDepartmentDecisionAsBplo(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const { submitDepartmentDecision } = await import("@/lib/review-workflow");
  await submitDepartmentDecision({
    departmentReviewId: String(formData.get("departmentReviewId")),
    decision: String(formData.get("decision")) as Decision,
    notes: String(formData.get("notes") ?? "").trim() || null,
    staff,
    actedOnBehalf: true,
  });

  revalidatePath("/dashboard/bplo");
}

/**
 * Manual LBT-category override -- stopgap now that the applicant form no
 * longer asks for this (the real intake form never did either; see
 * reference/official-application-form/README.md). Resolving Nature of
 * Business -> LBT schedule automatically is build order step 7's job; until
 * then, someone has to set businesses.lbt_category by hand or it's
 * permanently null. Uses BPLO's own RLS-scoped session -- migration 0009
 * added the "bplo can update businesses at their own lgu" policy this
 * relies on (businesses previously had no staff write policy at all).
 */
export async function setLbtCategory(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const businessId = String(formData.get("businessId"));
  const lbtCategory = String(formData.get("lbtCategory") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("businesses").update({ lbt_category: lbtCategory }).eq("id", businessId);
  if (error) throw error;

  revalidatePath("/dashboard/bplo");
}

// Exposed for the BPLO dashboard to look up documents for a given application.
export async function getApplicationDocuments(applicationId: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("documents")
    .select("id, document_type, file_url, uploaded_at")
    .eq("application_id", applicationId)
    .order("uploaded_at", { ascending: false });
  return data ?? [];
}
