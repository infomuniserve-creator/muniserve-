import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyApplicantSms, notifyStaffByRole, notifyStaffEmail } from "@/lib/notifications";
import { actorLabelFor, logAuditEvent } from "@/lib/audit-log";
import type { CurrentStaff } from "@/lib/staff";
import type { SupabaseClient } from "@supabase/supabase-js";

type DepartmentDecision = "approved" | "approved_with_condition" | "request_more_info" | "rejected";

/**
 * Opens a review round and fans it out to every active department at once
 * (rule #4). Shared by BPLO's "approve initial review" action and the
 * Business Registry's walk-in action -- both land an application at
 * pending_dept_review and need the exact same round-opening side effect,
 * so this used to be duplicated inline in bplo/actions.ts before the
 * walk-in feature needed it a second time.
 *
 * Takes the CALLER's own RLS-scoped client (not service-role) -- both
 * call sites run as BPLO, and migration 0008's review_rounds INSERT
 * policy + migration 0002's "bplo full access to department_reviews"
 * policy already cover this at the database layer.
 *
 * Notifies every fanned-out department's staff (CLAUDE.md 7w) -- before
 * this pass, a department only ever heard about a new item in their
 * queue via the 24-hour reminder cron if they hadn't acted yet, nothing
 * immediate. Both callers (submitInitialReview, startWalkInApplication)
 * get this for free.
 */
export async function openDepartmentReviewRound(
  supabase: SupabaseClient,
  applicationId: string,
  lguId: string,
  roundNumber = 1
) {
  const { data: round, error: roundError } = await supabase
    .from("review_rounds")
    .insert({ application_id: applicationId, round_number: roundNumber })
    .select("id")
    .single();
  if (roundError || !round) throw roundError ?? new Error("Failed to create review round");

  const { data: departments } = await supabase
    .from("lgu_departments")
    .select("name")
    .eq("lgu_id", lguId)
    .eq("is_active", true);

  if (departments?.length) {
    const { error: fanOutError } = await supabase.from("department_reviews").insert(
      departments.map((d) => ({ review_round_id: round.id, department: d.name, decision: "pending" }))
    );
    if (fanOutError) throw fanOutError;

    const { data: app } = await supabase
      .from("applications")
      .select("reference_number, business:businesses(business_name)")
      .eq("id", applicationId)
      .single();
    const businessName = (app?.business as unknown as { business_name: string } | null)?.business_name ?? "(business record missing)";
    const refNumber = app?.reference_number ?? applicationId;

    for (const d of departments) {
      await notifyStaffByRole(
        lguId,
        "department",
        applicationId,
        `New review needed: ${refNumber}`,
        `<p><strong>${businessName}</strong> (${refNumber}) needs ${d.name}'s review.</p>`,
        `MuniServe: ${businessName} (${refNumber}) needs your department's review.`,
        d.name
      );
    }
  }
}

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
 * Engineering's latest APPROVED assessed_amount for this application
 * (CLAUDE.md 7aa) -- "latest across rounds" for the identical reason
 * areAllDepartmentsCleared needs it: Engineering may have approved (and
 * entered their figure) in an earlier round and never been re-triggered
 * since (rule #6), so their real answer isn't necessarily on the most
 * recent round's own row. Used by both AssessmentCard's live preview and
 * finalizeAssessment's actual write, so the number BPLO sees before
 * finalizing is guaranteed to be the same one that gets charged.
 */
export async function getEngineeringAssessedAmount(applicationId: string): Promise<number | null> {
  const service = createServiceClient();

  const { data: rounds } = await service
    .from("review_rounds")
    .select("id, round_number")
    .eq("application_id", applicationId)
    .order("round_number", { ascending: false });
  if (!rounds || rounds.length === 0) return null;

  const roundIds = rounds.map((r) => r.id);
  const { data: reviews } = await service
    .from("department_reviews")
    .select("decision, assessed_amount, review_round_id")
    .eq("department", "Engineering")
    .in("review_round_id", roundIds);
  if (!reviews || reviews.length === 0) return null;

  const roundNumberById = new Map(rounds.map((r) => [r.id, r.round_number]));
  let latest: (typeof reviews)[number] | null = null;
  let latestRound = -1;
  for (const review of reviews) {
    const roundNumber = roundNumberById.get(review.review_round_id) ?? -1;
    if (roundNumber >= latestRound) {
      latestRound = roundNumber;
      latest = review;
    }
  }

  if (!latest || (latest.decision !== "approved" && latest.decision !== "approved_with_condition")) return null;
  return latest.assessed_amount != null ? Number(latest.assessed_amount) : null;
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
 *
 * assessedAmount (CLAUDE.md 7aa): Engineering's own computed Building
 * Permit Fee, when this LGU has that turned on. The primary guard is the
 * UI's Approve/Approve-with-condition buttons going inert without a
 * value (DepartmentReviewActions, a client component -- this needs to
 * react to live typing, the same reason AssessmentManualSection is a
 * client component); this is the defense-in-depth backstop against a
 * stale form submitting anyway, same "check before any write, not after"
 * shape as requireLbtCategorySet. Checked via a separate read before the
 * real update, since the department name isn't known from the caller's
 * params alone -- only from the row itself.
 */
export async function submitDepartmentDecision(params: {
  departmentReviewId: string;
  decision: DepartmentDecision;
  notes: string | null;
  assessedAmount: number | null;
  staff: CurrentStaff;
  actedOnBehalf: boolean;
}) {
  const { departmentReviewId, decision, notes, assessedAmount, staff, actedOnBehalf } = params;
  const supabase = await createClient();

  if (decision === "approved" || decision === "approved_with_condition") {
    const { data: reviewRow } = await supabase.from("department_reviews").select("department").eq("id", departmentReviewId).single();
    if (reviewRow?.department === "Engineering") {
      const { data: lgu } = await supabase.from("lgus").select("building_permit_fee_enabled").eq("id", staff.lgu_id).single();
      if (lgu?.building_permit_fee_enabled && (assessedAmount == null || assessedAmount <= 0)) {
        throw new Error("Enter the Building Permit Fee amount before approving.");
      }
    }
  }

  const { data: updated, error } = await supabase
    .from("department_reviews")
    .update({
      assessed_amount: assessedAmount,
      decision,
      notes,
      reviewer_id: staff.id,
      acted_on_behalf: actedOnBehalf,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", departmentReviewId)
    .eq("decision", "pending")
    .select("review_round_id, department")
    .single();
  if (error || !updated) throw error ?? new Error("Decision update failed or was already made");

  const service = createServiceClient();

  // Logged once here regardless of decision outcome (CLAUDE.md 7o
  // follow-up) -- every department decision matters for the audit trail,
  // not just rejections. actorLabel reflects who's actually acting: the
  // department reviewer themselves, or BPLO tagged as acting on their
  // behalf (rule #9).
  const { data: roundForLog } = await service
    .from("review_rounds")
    .select("application_id")
    .eq("id", updated.review_round_id)
    .single();
  if (roundForLog) {
    const { data: app } = await service.from("applications").select("reference_number").eq("id", roundForLog.application_id).single();
    await logAuditEvent(supabase, {
      lguId: staff.lgu_id,
      applicationId: roundForLog.application_id,
      actorRole: staff.role,
      actorLabel: actedOnBehalf ? `${actorLabelFor(staff)} on behalf of ${updated.department}` : actorLabelFor(staff),
      action: "department_decision",
      summary: `${updated.department}: ${decision.replace(/_/g, " ")} for ${app?.reference_number ?? roundForLog.application_id}`,
      details: { department: updated.department, decision, notes, actedOnBehalf },
    });
  }

  // Rule #5: a rejection/request-for-info doesn't halt the round -- nothing
  // to advance, other departments keep going, but the applicant and BPLO
  // should hear about it immediately rather than waiting for the round to
  // finish (CLAUDE.md section 6's notification rules).
  if (decision === "rejected" || decision === "request_more_info") {
    const { data: round } = await service
      .from("review_rounds")
      .select("application_id")
      .eq("id", updated.review_round_id)
      .single();
    if (round) {
      await notifyDepartmentIssue(service, round.application_id, staff.lgu_id, updated.department, decision, notes);
    }
    return;
  }

  if (decision !== "approved" && decision !== "approved_with_condition") return;

  const { data: round } = await service
    .from("review_rounds")
    .select("application_id")
    .eq("id", updated.review_round_id)
    .single();
  if (!round) return;

  const cleared = await areAllDepartmentsCleared(round.application_id, staff.lgu_id);
  if (cleared) {
    const { data: updatedApp } = await service
      .from("applications")
      .update({ status: "pending_bplo_assessment" })
      .eq("id", round.application_id)
      .eq("status", "pending_dept_review")
      .select("reference_number, business:businesses(business_name)")
      .single();

    // BPLO needs to hear about this the moment it happens, same as a
    // rejection/request-for-info above -- an application ready for
    // assessment used to sit silently until someone happened to check
    // the dashboard (CLAUDE.md 7w).
    if (updatedApp) {
      const biz = updatedApp.business as unknown as { business_name: string } | null;
      await notifyStaffByRole(
        staff.lgu_id,
        "bplo",
        round.application_id,
        `Ready for assessment: ${updatedApp.reference_number}`,
        `<p><strong>${biz?.business_name ?? "(business record missing)"}</strong> (${updatedApp.reference_number}) cleared all departments -- ready for fee assessment.</p>`,
        `MuniServe: ${biz?.business_name ?? "Application"} (${updatedApp.reference_number}) cleared all departments -- ready for assessment.`
      );
    }
  }
}

/**
 * CLAUDE.md section 6: "Immediate notification to both the applicant and
 * BPLO the moment any department sets decision to rejected or
 * request_more_info -- don't wait for the other departments." Applicant
 * gets an SMS (phone is their real identity in this system); BPLO gets
 * an email to every active bplo staff_user at the LGU, since there's no
 * single "BPLO inbox" to address instead. Uses the service-role client
 * throughout -- the acting department's own RLS session has no reason to
 * be able to read full business/owner/other-staff details, so this
 * shouldn't lean on it even though the call site already has it.
 */
async function notifyDepartmentIssue(
  service: SupabaseClient,
  applicationId: string,
  lguId: string,
  department: string,
  decision: "rejected" | "request_more_info",
  notes: string | null
) {
  const { data: application } = await service
    .from("applications")
    .select("reference_number, business:businesses(business_name, owner:owners(phone))")
    .eq("id", applicationId)
    .single();
  if (!application) return;

  const business = application.business as unknown as {
    business_name: string;
    owner: { phone: string | null } | null;
  } | null;
  const verbPast = decision === "rejected" ? "was rejected by" : "needs more information from";

  if (business?.owner?.phone) {
    await notifyApplicantSms(
      applicationId,
      business.owner.phone,
      `MuniServe: your application ${application.reference_number} ${verbPast} ${department}. Check your application status page for details.`
    );
  }

  const { data: bploStaff } = await service
    .from("staff_users")
    .select("email")
    .eq("lgu_id", lguId)
    .eq("role", "bplo")
    .eq("is_active", true)
    // Excludes a platform admin's "view as BPLO" proxy row (CLAUDE.md 7o
    // follow-up) -- its email is a synthetic, unreachable placeholder, so
    // this would otherwise just be a guaranteed-failing send attempt.
    .eq("is_admin_proxy", false);

  const subject = `Application ${application.reference_number}: ${department} ${decision === "rejected" ? "rejected" : "requested more info"}`;
  const html = `<p><strong>${business?.business_name ?? "(business record missing)"}</strong> (${application.reference_number}) -- ${department} ${
    decision === "rejected" ? "rejected" : "requested more information"
  } during department review.</p>${notes ? `<p>Notes: ${notes}</p>` : ""}`;
  for (const s of bploStaff ?? []) {
    if (s.email) await notifyStaffEmail(applicationId, s.email, subject, html);
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
