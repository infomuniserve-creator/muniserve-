import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyApplicantEmail, notifyApplicantSms, notifyStaffByRole } from "@/lib/notifications";
import { logAuditEvent } from "@/lib/audit-log";
import { getLguDisplay } from "@/lib/lgu";
import { firstNameOf, noteBoxHtml, renderApplicantEmailHtml } from "@/lib/applicant-email-template";

/**
 * Closes the "request more info" loop (2026-08-16) -- one shared record
 * type behind all three reviewing surfaces (BPLO's own initial review,
 * any department, and Treasury, which never had a "request more info"
 * mechanism before this) instead of three separate ad hoc ones. Each
 * surface still keeps its own existing decision-recording (department_
 * reviews.decision, applications.initial_review_decision) -- info_requests
 * is a parallel, purpose-built "is the applicant still expected to send
 * us something" queue that the applicant's status page and the upload-
 * triggered auto-requeue logic both read from a single source, rather
 * than each reconstructing that answer from a different table's own shape.
 */
export type InfoRequestRole = "bplo_initial" | "department" | "treasury";

/**
 * Inserts one info_requests row and notifies the applicant -- SMS always
 * (phone is guaranteed), email too when the owner has one on file (a
 * deliberate, one-off exception to "applicants are SMS-only," same
 * reasoning as the Order of Payment's own notifyApplicantEmail use).
 * Takes the CALLER's own RLS-scoped session -- migration 0041's INSERT
 * policies are what actually authorize this write per role, so this must
 * never be called with a service-role client.
 */
export async function createInfoRequest(
  supabase: SupabaseClient,
  params: {
    applicationId: string;
    lguId: string;
    requestedByRole: InfoRequestRole;
    department?: string | null;
    notes: string | null;
    requestedBy: string;
    actedOnBehalf: boolean;
    isRejection: boolean; // wording only -- "was rejected by" vs "needs more information from". Treasury never rejects, only requests.
    roleLabel: string; // what the applicant sees, e.g. "BPLO", "MENRO", "Treasury"
  }
): Promise<void> {
  const { error: insertError } = await supabase.from("info_requests").insert({
    application_id: params.applicationId,
    lgu_id: params.lguId,
    requested_by_role: params.requestedByRole,
    department: params.department ?? null,
    notes: params.notes,
    requested_by: params.requestedBy,
    acted_on_behalf: params.actedOnBehalf,
  });
  if (insertError) throw insertError;

  const { data: application } = await supabase
    .from("applications")
    .select("reference_number, business:businesses(owner:owners(phone, email, full_name))")
    .eq("id", params.applicationId)
    .single();
  if (!application) return;
  const owner = (application.business as unknown as { owner: { phone: string | null; email: string | null; full_name: string | null } | null } | null)?.owner;
  const ref = application.reference_number;

  const smsMessage = params.isRejection
    ? `Your application ${ref} was not approved by ${params.roleLabel}. Check your email or status page for details.`
    : `${params.roleLabel} needs one more thing from you for application ${ref}. Check your email or status page to upload it.`;

  if (owner?.phone) {
    await notifyApplicantSms(params.applicationId, params.lguId, owner.phone, smsMessage);
  }

  if (owner?.email) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const statusUrl = `${appUrl}/status/${ref}`;
    const lgu = await getLguDisplay(supabase, params.lguId);
    const subject = params.isRejection ? `Update on your application ${ref}` : `One more document needed — ${ref}`;
    const bodyHtml = params.isRejection
      ? `<p style="margin:0 0 6px;">Your application (<strong>${ref}</strong>) was not approved by <strong>${params.roleLabel}</strong>.</p>${
          params.notes ? noteBoxHtml(params.notes) : ""
        }<p style="margin:0;">If you have questions, please visit the BPLO office.</p>`
      : `<p style="margin:0 0 6px;"><strong>${params.roleLabel}</strong> is reviewing your application (<strong>${ref}</strong>) and needs one more thing from you:</p>${
          params.notes ? noteBoxHtml(params.notes) : ""
        }<p style="margin:0;">Everything else on your application is fine — once you upload this, ${params.roleLabel} will automatically continue reviewing it. You don't need to call or visit.</p>`;
    const html = renderApplicantEmailHtml({
      lgu,
      officeLabel: params.roleLabel,
      greetingName: firstNameOf(owner.full_name),
      bodyHtml,
      cta: { label: params.isRejection ? "View your application status" : "Upload the document now", href: statusUrl },
    });
    await notifyApplicantEmail(params.applicationId, owner.email, subject, html);
  }
}

/**
 * Opens a fresh review round for exactly the given department(s) --
 * extracted out of bplo/actions.ts's resubmitToDepartments (the manual
 * "BPLO confirms the applicant fixed it" button) so the same logic also
 * powers the new automatic path (resolveOpenInfoRequests below), rather
 * than the automatic path reimplementing round-creation a second time.
 * Takes the caller's own client -- the manual button passes BPLO's own
 * RLS-scoped session (migration 0008's INSERT policy), the automatic
 * path passes service-role (no staff session exists on an applicant's
 * own upload request).
 */
export async function reopenDepartmentRound(supabase: SupabaseClient, applicationId: string, lguId: string, departments: string[]): Promise<void> {
  if (departments.length === 0) return;

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

  const { data: app } = await supabase
    .from("applications")
    .select("reference_number, business:businesses(business_name, owner:owners(full_name))")
    .eq("id", applicationId)
    .single();
  const biz = app?.business as unknown as { business_name: string; owner: { full_name: string | null } | null } | null;
  const businessName = biz?.business_name ?? "(business record missing)";
  const ownerName = biz?.owner?.full_name ?? "Unknown owner";
  const refNumber = app?.reference_number ?? applicationId;
  for (const department of departments) {
    await notifyStaffByRole(
      lguId,
      "department",
      applicationId,
      `Resubmitted for review: ${refNumber}`,
      `<p><strong>${businessName}</strong> (Owner: ${ownerName}) was resubmitted -- needs ${department}'s re-review.</p><p>Application: ${refNumber}</p>`,
      `${businessName} (${refNumber}) was resubmitted -- needs your department's re-review.`,
      department
    );
  }
}

/**
 * The actual loop-closer: called right after an applicant's document
 * upload succeeds (upload-additional-document/route.ts). Finds every
 * still-open info_requests row for the application, marks them all
 * resolved in one shot, and routes each distinct requester type back to
 * whoever asked -- a fresh department review round, BPLO's initial-review
 * queue (flips applications.status back from returned_to_applicant), or
 * just a Treasury notification (non-blocking -- Treasury's request never
 * changed applications.status in the first place, per the project
 * owner's own call).
 *
 * Deliberately resolves ALL open requests on one upload rather than
 * asking the applicant which one it's for -- the existing upload widget
 * has no such selector, and if two departments both flagged something,
 * sending it back to both to take another look is the safe default (the
 * cost of a department re-checking something already fine is low; a
 * document silently going to only one of two departments that asked is
 * the worse failure mode). A per-request-targeted upload is reasonable
 * future work, not built here.
 *
 * Returns the number of requests resolved, so the caller can skip its
 * OWN generic "notify whoever can currently act" fallback when this
 * already notified the right people more precisely -- avoids double-
 * notifying the same recipient with two different messages for one upload.
 *
 * `documentId` (2026-08-21, real gap the project owner reported): staff
 * were being notified correctly, but the resulting document then landed
 * in the same flat list as everything from the original application --
 * nothing showed which upload actually answered their request. Stamped
 * onto every info_requests row this resolves (documents.ts's DocumentList
 * reads it back to highlight exactly that document and show what was
 * asked for) -- one document can still resolve several requests at once
 * (unchanged), it's just now recorded which one did.
 */
export async function resolveOpenInfoRequests(supabase: SupabaseClient, applicationId: string, lguId: string, documentId: string): Promise<number> {
  const { data: open } = await supabase
    .from("info_requests")
    .select("id, requested_by_role, department")
    .eq("application_id", applicationId)
    .is("resolved_at", null);
  const requests = open ?? [];
  if (requests.length === 0) return 0;

  const { error: resolveError } = await supabase
    .from("info_requests")
    .update({ resolved_at: new Date().toISOString(), resolved_by_document_id: documentId })
    .eq("application_id", applicationId)
    .is("resolved_at", null);
  if (resolveError) throw resolveError;

  const { data: app } = await supabase
    .from("applications")
    .select("reference_number, business:businesses(business_name, owner:owners(full_name))")
    .eq("id", applicationId)
    .single();
  const ref = app?.reference_number ?? applicationId;
  const biz = app?.business as unknown as { business_name: string; owner: { full_name: string | null } | null } | null;
  const businessName = biz?.business_name ?? "(business record missing)";
  const ownerName = biz?.owner?.full_name ?? "Unknown owner";

  const departments = [...new Set(requests.filter((r) => r.requested_by_role === "department" && r.department).map((r) => r.department as string))];
  if (departments.length > 0) {
    await reopenDepartmentRound(supabase, applicationId, lguId, departments);
  }

  if (requests.some((r) => r.requested_by_role === "bplo_initial")) {
    await supabase.from("applications").update({ status: "pending_bplo_initial" }).eq("id", applicationId).eq("status", "returned_to_applicant");
    await notifyStaffByRole(
      lguId,
      "bplo",
      applicationId,
      `Ready for re-review: ${ref}`,
      `<p><strong>${businessName}</strong> (Owner: ${ownerName}) -- applicant uploaded the requested document(s). Ready for another initial review pass.</p><p>Application: ${ref}</p>`,
      `${businessName} (${ref}) -- applicant uploaded the requested document(s), ready for another look.`
    );
  }

  if (requests.some((r) => r.requested_by_role === "treasury")) {
    await notifyStaffByRole(
      lguId,
      "treasury",
      applicationId,
      `Update from applicant: ${ref}`,
      `<p><strong>${businessName}</strong> (Owner: ${ownerName}) -- applicant uploaded the requested document(s).</p><p>Application: ${ref}</p>`,
      `${businessName} (${ref}) -- applicant uploaded the requested document(s).`
    );
  }

  await logAuditEvent(supabase, {
    lguId,
    applicationId,
    actorRole: null,
    actorLabel: "Applicant",
    action: "info_request_resolved",
    summary: `Applicant uploaded a document for ${ref} -- ${requests.length} open request${requests.length === 1 ? "" : "s"} resolved`,
    details: { resolvedCount: requests.length, roles: requests.map((r) => r.requested_by_role) },
  });

  return requests.length;
}
