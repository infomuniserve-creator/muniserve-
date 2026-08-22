import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyStaffByRole, notifyStaffEmail } from "@/lib/notifications";
import { actorLabelFor, logAuditEvent } from "@/lib/audit-log";
import { createInfoRequest } from "@/lib/info-requests";
import { getLguDisplay } from "@/lib/lgu";
import { firstNameOf, noteBoxHtml, renderApplicantEmailHtml } from "@/lib/applicant-email-template";
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
      .select("reference_number, business:businesses(business_name, owner:owners(full_name))")
      .eq("id", applicationId)
      .single();
    const biz = app?.business as unknown as { business_name: string; owner: { full_name: string | null } | null } | null;
    const businessName = biz?.business_name ?? "(business record missing)";
    const ownerName = biz?.owner?.full_name ?? "Unknown owner";
    const refNumber = app?.reference_number ?? applicationId;

    for (const d of departments) {
      await notifyStaffByRole(
        lguId,
        "department",
        applicationId,
        `New review needed: ${refNumber}`,
        `<p><strong>${businessName}</strong> (Owner: ${ownerName}) needs ${d.name}'s review.</p><p>Application: ${refNumber}</p>`,
        `${businessName} (${refNumber}) needs your department's review.`,
        d.name
      );
    }
    return;
  }

  // Audit finding (2026-08-17): zero active departments used to leave this
  // review_rounds row with no department_reviews children at all --
  // nothing but a real department decision ever calls
  // areAllDepartmentsCleared, and with no departments left to decide
  // anything, nothing would ever trigger that check. The application sat
  // at pending_dept_review forever with literally no path forward. If an
  // LGU genuinely has zero active reviewing departments, there's nothing
  // to wait for -- advance straight through to the same place a normal
  // round lands once every department actually clears.
  const service = createServiceClient();
  const { data: updatedApp } = await service
    .from("applications")
    .update({ status: "pending_bplo_assessment" })
    .eq("id", applicationId)
    .eq("status", "pending_dept_review")
    .select("reference_number, business:businesses(business_name, owner:owners(full_name))")
    .single();
  if (updatedApp) {
    const biz = updatedApp.business as unknown as { business_name: string; owner: { full_name: string | null } | null } | null;
    const businessName = biz?.business_name ?? "(business record missing)";
    const ownerName = biz?.owner?.full_name ?? "Unknown owner";
    await notifyStaffByRole(
      lguId,
      "bplo",
      applicationId,
      `Ready for assessment: ${updatedApp.reference_number}`,
      `<p><strong>${businessName}</strong> (Owner: ${ownerName}) -- no active departments to review, ready for fee assessment.</p><p>Application: ${updatedApp.reference_number}</p>`,
      `${businessName} (${updatedApp.reference_number}) -- no active departments to review, ready for assessment.`
    );
  }
}

/**
 * Whether every department THIS APPLICATION HAS ACTUALLY BEEN THROUGH has,
 * as of its MOST RECENT decision (which may span multiple review_rounds --
 * rule #6: a department that already approved in an earlier round isn't
 * re-triggered on resubmission, so its approval has to keep counting),
 * approved or approved_with_condition.
 *
 * Audit finding (2026-08-17): used to re-derive "who must decide" from a
 * LIVE query of lgu_departments.is_active at check-time instead of the
 * department_reviews rows actually created when each round opened -- two
 * real structural dead-ends followed. A department deactivated after a
 * round opened had its still-pending row silently excluded from this
 * check (the round "cleared" without it ever actually deciding, with no
 * trace anything was skipped). A department activated AFTER a round
 * opened was required by the live check despite having no row in that
 * round at all -- and nothing anywhere ever creates one for an
 * already-open round, so that application could never clear again, full
 * stop. Checking every department this function has ever seen a ROW for
 * (latestByDept's own keys, not a live lgu_departments query) fixes both:
 * a department with no row in any round for this application was never
 * asked and isn't required; one that DID get a row keeps being required
 * for real even if later deactivated -- visibly stuck rather than
 * silently skipped, recoverable via the widened Archive action
 * (bplo/actions.ts) if it's truly a dead end.
 *
 * Uses the service-role client deliberately: this check runs as a
 * system-driven side effect after a department (or BPLO on their behalf)
 * submits a decision via their own RLS-scoped session -- advancing
 * applications.status is not something the acting department has (or
 * should have) direct UPDATE rights to do themselves.
 */
export async function areAllDepartmentsCleared(applicationId: string): Promise<boolean> {
  const supabase = createServiceClient();

  // QA sweep finding (2026-08-20): both queries below used to destructure
  // only `data`, never checking `error` -- a genuine transient query
  // failure (network blip, connection exhaustion) looked identical to
  // "nothing to wait for yet," silently reporting `false` with no error
  // trail. Fails safe (blocks progress rather than wrongly advancing an
  // application), but produces an unexplained "why won't this move to
  // assessment" support case. Now throws on a real error, distinct from a
  // legitimately empty result.
  const { data: rounds, error: roundsError } = await supabase
    .from("review_rounds")
    .select("id, round_number")
    .eq("application_id", applicationId)
    .order("round_number", { ascending: false });
  if (roundsError) throw roundsError;
  if (!rounds || rounds.length === 0) return false;

  const roundIds = rounds.map((r) => r.id);
  const { data: reviews, error: reviewsError } = await supabase
    .from("department_reviews")
    .select("department, decision, review_round_id")
    .in("review_round_id", roundIds);
  if (reviewsError) throw reviewsError;
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

  // No department has ever had a row for this application (the
  // zero-active-departments case, handled proactively by
  // openDepartmentReviewRound below -- this is a defensive fallback, not
  // the only place that case is covered) -- vacuously nothing left to wait for.
  if (latestByDept.size === 0) return true;

  return Array.from(latestByDept.values()).every((decision) => decision === "approved" || decision === "approved_with_condition");
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

  // QA sweep finding (2026-08-20): see areAllDepartmentsCleared's identical
  // comment above -- same silent-failure gap, same fix.
  const { data: rounds, error: roundsError } = await service
    .from("review_rounds")
    .select("id, round_number")
    .eq("application_id", applicationId)
    .order("round_number", { ascending: false });
  if (roundsError) throw roundsError;
  if (!rounds || rounds.length === 0) return null;

  const roundIds = rounds.map((r) => r.id);
  const { data: reviews, error: reviewsError } = await service
    .from("department_reviews")
    .select("decision, assessed_amount, review_round_id")
    .eq("department", "Engineering")
    .in("review_round_id", roundIds);
  if (reviewsError) throw reviewsError;
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
 * react to live typing, the same reason bplo/assessment-line-items.tsx's
 * AssessmentLineItems is a client component); this is the defense-in-depth backstop against a
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

  // Real audit finding, closed for real (2026-08-21): the 2026-08-20 audit
  // pass's own fix only made the "Notes (required if...)" hint persist
  // visually instead of vanishing once someone typed -- it never actually
  // required anything, on this surface either. Confirmed live. The
  // primary guard is the client-side check in DepartmentReviewActions
  // (guardNotesRequired, ui.tsx); this is the actual guarantee.
  if ((decision === "approved_with_condition" || decision === "request_more_info" || decision === "rejected") && !notes) {
    throw new Error("Notes are required when requesting more info, approving with a condition, or rejecting.");
  }

  const supabase = await createClient();

  // Fetch once up front: the department name (for the Engineering gate
  // below) and which round this row belongs to. The UI only ever renders
  // an "Act for {department}" button for a pending row in the latest
  // round, but nothing server-side enforced that -- a crafted or stale
  // form submission could reference an older, superseded round's still-
  // pending row and still succeed, since RLS only checks "same LGU," not
  // "this is the round that's actually open right now." Checked before
  // any write, same "guard before touching data" shape as the rest of
  // this function's own precedents (requireLbtCategorySet, the Engineering
  // amount check just below).
  const { data: reviewRow } = await supabase
    .from("department_reviews")
    .select("department, review_round_id, review_round:review_rounds(application_id, round_number)")
    .eq("id", departmentReviewId)
    .single();
  if (!reviewRow) throw new Error("Review not found");
  const ownRound = reviewRow.review_round as unknown as { application_id: string; round_number: number } | null;
  if (!ownRound) throw new Error("Review round not found");

  const { data: latestRound } = await supabase
    .from("review_rounds")
    .select("round_number")
    .eq("application_id", ownRound.application_id)
    .order("round_number", { ascending: false })
    .limit(1)
    .single();
  if (!latestRound || latestRound.round_number !== ownRound.round_number) {
    throw new Error("This review is from an earlier round and is no longer open.");
  }

  if (decision === "approved" || decision === "approved_with_condition") {
    if (reviewRow.department === "Engineering") {
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
      // Closes the "request more info" loop (2026-08-16) -- the applicant's
      // status page now shows this note and an upload box, and uploading
      // auto-requeues straight back to this same department
      // (info-requests.ts's resolveOpenInfoRequests). Uses the caller's
      // own RLS-scoped session (`supabase`, not `service`) -- migration
      // 0041's INSERT policy is what actually authorizes this write.
      await createInfoRequest(supabase, {
        applicationId: round.application_id,
        lguId: staff.lgu_id,
        requestedByRole: "department",
        department: updated.department,
        notes,
        requestedBy: staff.id,
        actedOnBehalf,
        isRejection: decision === "rejected",
        roleLabel: updated.department,
      });
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

  const cleared = await areAllDepartmentsCleared(round.application_id);
  if (cleared) {
    const { data: updatedApp } = await service
      .from("applications")
      .update({ status: "pending_bplo_assessment" })
      .eq("id", round.application_id)
      .eq("status", "pending_dept_review")
      .select("reference_number, business:businesses(business_name, owner:owners(full_name))")
      .single();

    // BPLO needs to hear about this the moment it happens, same as a
    // rejection/request-for-info above -- an application ready for
    // assessment used to sit silently until someone happened to check
    // the dashboard (CLAUDE.md 7w).
    if (updatedApp) {
      const biz = updatedApp.business as unknown as { business_name: string; owner: { full_name: string | null } | null } | null;
      const businessName = biz?.business_name ?? "(business record missing)";
      const ownerName = biz?.owner?.full_name ?? "Unknown owner";
      await notifyStaffByRole(
        staff.lgu_id,
        "bplo",
        round.application_id,
        `Ready for assessment: ${updatedApp.reference_number}`,
        `<p><strong>${businessName}</strong> (Owner: ${ownerName}) cleared all departments -- ready for fee assessment.</p><p>Application: ${updatedApp.reference_number}</p>`,
        `${businessName} (${updatedApp.reference_number}) cleared all departments -- ready for assessment.`
      );
    }
  }
}

/**
 * CLAUDE.md section 6: "Immediate notification to both the applicant and
 * BPLO the moment any department sets decision to rejected or
 * request_more_info -- don't wait for the other departments." BPLO gets
 * an email to every active bplo staff_user at the LGU, since there's no
 * single "BPLO inbox" to address instead. The applicant's own
 * notification (SMS + email) is handled by createInfoRequest, called
 * alongside this at the same call site -- kept as two functions since
 * they notify different audiences for different reasons, not because
 * they need to happen at different times.
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
    .select("reference_number, business:businesses(business_name, owner:owners(full_name))")
    .eq("id", applicationId)
    .single();
  if (!application) return;

  const business = application.business as unknown as { business_name: string; owner: { full_name: string | null } | null } | null;
  const businessName = business?.business_name ?? "(business record missing)";
  const ownerName = business?.owner?.full_name ?? "Unknown owner";

  const { data: bploStaff } = await service
    .from("staff_users")
    .select("email, full_name")
    .eq("lgu_id", lguId)
    .eq("role", "bplo")
    .eq("is_active", true)
    // Excludes a platform admin's "view as BPLO" proxy row (CLAUDE.md 7o
    // follow-up) -- its email is a synthetic, unreachable placeholder, so
    // this would otherwise just be a guaranteed-failing send attempt.
    .eq("is_admin_proxy", false);
  if (!bploStaff || bploStaff.length === 0) return;

  const lgu = await getLguDisplay(service, lguId);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const subject = `Application ${application.reference_number}: ${department} ${decision === "rejected" ? "rejected" : "requested more info"}`;
  const bodyHtml = `<p><strong>${businessName}</strong> (Owner: ${ownerName}) -- ${department} ${
    decision === "rejected" ? "rejected" : "requested more information"
  } during department review.</p><p>Application: ${application.reference_number}</p>${notes ? noteBoxHtml(notes) : ""}`;
  for (const s of bploStaff) {
    if (!s.email) continue;
    const html = renderApplicantEmailHtml({
      lgu,
      officeLabel: lgu.bploOfficeName,
      greetingName: firstNameOf(s.full_name),
      bodyHtml,
      cta: { label: "Open dashboard", href: `${appUrl}/login` },
    });
    await notifyStaffEmail(applicationId, s.email, subject, html);
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

export type ResolvedInfoRequestSummary = { requestedByRole: string; department: string | null; notes: string | null };
export type ApplicationDocument = {
  id: string;
  document_type: string | null;
  file_url: string | null;
  uploaded_at: string | null;
  resolvedRequests: ResolvedInfoRequestSummary[];
  purpose: string | null;
};

/**
 * Every document uploaded against an application, for the three staff
 * surfaces that show them (BPLO's initial review, a department's own
 * review, the shared payment queue) -- previously duplicated verbatim in
 * bplo/actions.ts and department/actions.ts, consolidated here (2026-08-21)
 * since both copies needed the identical fix below.
 *
 * `resolvedRequests` (real gap the project owner reported, 2026-08-21):
 * staff were already notified when a document answered their info
 * request, but the document itself then landed in the same flat list as
 * everything from the original application -- nothing showed WHICH
 * upload was the actual response, or what had been asked for. Joins
 * against `info_requests.resolved_by_document_id` (migration 0058) --
 * one document can resolve several open requests at once (unchanged
 * behavior, see resolveOpenInfoRequests), so this is an array per
 * document, not a single flag.
 */
export async function getApplicationDocuments(applicationId: string): Promise<ApplicationDocument[]> {
  const supabase = createServiceClient();
  const { data: documents } = await supabase
    .from("documents")
    .select("id, document_type, file_url, uploaded_at, purpose")
    .eq("application_id", applicationId)
    .order("uploaded_at", { ascending: false });
  if (!documents || documents.length === 0) return [];

  const { data: resolved } = await supabase
    .from("info_requests")
    .select("resolved_by_document_id, requested_by_role, department, notes")
    .in("resolved_by_document_id", documents.map((d) => d.id));

  const byDocumentId = new Map<string, ResolvedInfoRequestSummary[]>();
  for (const r of resolved ?? []) {
    if (!r.resolved_by_document_id) continue;
    const list = byDocumentId.get(r.resolved_by_document_id) ?? [];
    list.push({ requestedByRole: r.requested_by_role, department: r.department, notes: r.notes });
    byDocumentId.set(r.resolved_by_document_id, list);
  }

  return documents.map((d) => ({ ...d, resolvedRequests: byDocumentId.get(d.id) ?? [] }));
}
