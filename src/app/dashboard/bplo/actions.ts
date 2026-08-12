"use server";

import { getCurrentStaff } from "@/lib/staff";
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
    const { data: round, error: roundError } = await supabase
      .from("review_rounds")
      .insert({ application_id: applicationId, round_number: 1 })
      .select("id")
      .single();
    if (roundError || !round) throw roundError ?? new Error("Failed to create review round");

    const { data: departments } = await supabase
      .from("lgu_departments")
      .select("name")
      .eq("lgu_id", staff.lgu_id)
      .eq("is_active", true);

    if (departments?.length) {
      const { error: fanOutError } = await supabase.from("department_reviews").insert(
        departments.map((d) => ({ review_round_id: round.id, department: d.name, decision: "pending" }))
      );
      if (fanOutError) throw fanOutError;
    }
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
 * The fee computation engine is build order step 7, not built yet -- this
 * only wires the status transition itself. Nothing here computes or
 * stores fee amounts; application_fee_lines stays empty until step 7 lands.
 */
export async function finalizeAssessment(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const applicationId = String(formData.get("applicationId"));
  const supabase = await createClient();

  const { error } = await supabase
    .from("applications")
    .update({ status: "pending_payment" })
    .eq("id", applicationId)
    .eq("status", "pending_bplo_assessment");
  if (error) throw error;

  revalidatePath("/dashboard/bplo");
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
