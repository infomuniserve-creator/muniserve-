import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { CurrentStaff } from "@/lib/staff";

type DepartmentDecision = "approved" | "approved_with_condition" | "request_more_info" | "rejected";

/**
 * Whether every active department for an LGU has, as of its MOST RECENT
 * decision for this application (which may span multiple review_rounds --
 * rule #6: a department that already approved in an earlier round isn't
 * re-triggered on resubmission, so its approval has to keep counting),
 * approved or approved_with_condition.
 *
 * Uses the service-role client deliberately: this check runs as a
 * system-driven side effect after a department (or BPLO on their behalf)
 * submits a decision via their own RLS-scoped session -- advancing
 * applications.status is not something the acting department has (or
 * should have) direct UPDATE rights to do themselves.
 */
export async function areAllDepartmentsCleared(applicationId: string, lguId: string): Promise<boolean> {
  const supabase = createServiceClient();

  const { data: departments } = await supabase
    .from("lgu_departments")
    .select("name")
    .eq("lgu_id", lguId)
    .eq("is_active", true);
  if (!departments || departments.length === 0) return false;

  const { data: rounds } = await supabase
    .from("review_rounds")
    .select("id, round_number")
    .eq("application_id", applicationId)
    .order("round_number", { ascending: false });
  if (!rounds || rounds.length === 0) return false;

  const roundIds = rounds.map((r) => r.id);
  const { data: reviews } = await supabase
    .from("department_reviews")
    .select("department, decision, review_round_id")
    .in("review_round_id", roundIds);
  if (!reviews) return false;

  const roundNumberById = new Map(rounds.map((r) => [r.id, r.round_number]));

  // Latest decision per department, by round_number (ties broken arbitrarily --
  // a department only ever has one row per round).
  const latestByDept = new Map<string, string>();
  const latestRoundByDept = new Map<string, number>();
  for (const review of reviews) {
    const roundNumber = roundNumberById.get(review.review_round_id) ?? -1;
    const seenRound = latestRoundByDept.get(review.department) ?? -1;
    if (roundNumber >= seenRound) {
      latestRoundByDept.set(review.department, roundNumber);
      latestByDept.set(review.department, review.decision);
    }
  }

  return departments.every((d) => {
    const decision = latestByDept.get(d.name);
    return decision === "approved" || decision === "approved_with_condition";
  });
}

/**
 * Shared by both the department dashboard's own-department action and
 * BPLO's "act on a department's behalf" action (rule #9) -- same
 * decision-recording logic either way, only the actor and the
 * acted_on_behalf tag differ. Updates department_reviews via the ACTING
 * staff member's own RLS-scoped session (migration 0002's department/bplo
 * policies on department_reviews enforce rule #8/#9 for real at the
 * database layer here -- a department member's session physically cannot
 * write another department's row, regardless of what this function tries
 * to do), then -- only if that succeeds -- uses the service-role client to
 * check rule #5/#6's all-clear condition and advance applications.status
 * if every active department's latest decision now clears.
 */
export async function submitDepartmentDecision(params: {
  departmentReviewId: string;
  decision: DepartmentDecision;
  notes: string | null;
  staff: CurrentStaff;
  actedOnBehalf: boolean;
}) {
  const { departmentReviewId, decision, notes, staff, actedOnBehalf } = params;
  const supabase = await createClient();

  const { data: updated, error } = await supabase
    .from("department_reviews")
    .update({
      decision,
      notes,
      reviewer_id: staff.id,
      acted_on_behalf: actedOnBehalf,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", departmentReviewId)
    .eq("decision", "pending")
    .select("review_round_id")
    .single();
  if (error || !updated) throw error ?? new Error("Decision update failed or was already made");

  // Rule #5: a rejection/request-for-info doesn't halt the round -- nothing
  // to advance, other departments keep going. Only check all-clear on a
  // positive decision.
  if (decision !== "approved" && decision !== "approved_with_condition") return;

  const service = createServiceClient();
  const { data: round } = await service
    .from("review_rounds")
    .select("application_id")
    .eq("id", updated.review_round_id)
    .single();
  if (!round) return;

  const cleared = await areAllDepartmentsCleared(round.application_id, staff.lgu_id);
  if (cleared) {
    await service
      .from("applications")
      .update({ status: "pending_bplo_assessment" })
      .eq("id", round.application_id)
      .eq("status", "pending_dept_review");
  }
}

/** Generates a short-lived signed URL for a private application-documents object. */
export async function getSignedDocumentUrl(filePath: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from("application-documents")
    .createSignedUrl(filePath, 60 * 10); // 10 minutes
  if (error || !data) return null;
  return data.signedUrl;
}
