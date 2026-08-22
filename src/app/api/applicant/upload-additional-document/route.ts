import { getApplicantOwnerId } from "@/lib/applicant-session";
import { verifyUploadedObject } from "@/lib/document-upload";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyApplicantSms, notifyStaffByRole } from "@/lib/notifications";
import { resolveOpenInfoRequests } from "@/lib/info-requests";
import { DOCUMENT_PURPOSE_LABELS } from "@/lib/document-purpose";
import { NextResponse } from "next/server";

/**
 * Registers a document upload against an ALREADY-SUBMITTED application --
 * the BFP payment-proof screenshot (CLAUDE.md section 7c) being the
 * motivating case, but generally reusable for anything a department asks
 * for after the fact. Unlike upload-document (used during initial
 * submission, before an application row exists), this one requires the
 * application to already exist and belong to the caller's own owner --
 * verified via the business -> owner chain, not just the storage-path-
 * prefix trick upload-document uses for orphaned pre-submission documents.
 *
 * The browser already uploaded the file bytes directly to Storage via a
 * signed URL (request-upload-url/route.ts, 2026-08-17) -- this route never
 * sees the file itself, only the `path` it landed at.
 */
export async function POST(request: Request) {
  const ownerId = await getApplicantOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const path = String(body?.path ?? "");
  const documentType = String(body?.documentType ?? "");
  const applicationId = String(body?.applicationId ?? "");
  // Never trust the client's claimed purpose outright -- only a known key
  // from DOCUMENT_PURPOSE_LABELS is ever persisted, so a stray/tampered
  // value can't fabricate a highlighted card on staff's own DocumentList.
  const purposeRaw = body?.purpose;
  const purpose = typeof purposeRaw === "string" && purposeRaw in DOCUMENT_PURPOSE_LABELS ? purposeRaw : null;

  if (!path.startsWith(`${ownerId}/`) || !documentType || !applicationId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const verified = await verifyUploadedObject(supabase, path);
  if ("error" in verified) {
    return NextResponse.json({ error: verified.error }, { status: 400 });
  }

  const { data: application, error: fetchError } = await supabase
    .from("applications")
    .select("id, lgu_id, status, reference_number, business:businesses(business_name, owner_id, owner:owners(phone, full_name))")
    .eq("id", applicationId)
    .maybeSingle();
  const business = application?.business as unknown as { business_name: string; owner_id: string | null; owner: { phone: string | null; full_name: string | null } | null } | null;
  if (fetchError || !application || business?.owner_id !== ownerId) {
    return NextResponse.json({ error: "not_found_or_not_yours" }, { status: 403 });
  }

  const { data: newDocument, error: insertError } = await supabase
    .from("documents")
    .insert({ application_id: applicationId, document_type: documentType, file_url: path, purpose })
    .select("id")
    .single();
  if (insertError || !newDocument) {
    return NextResponse.json({ error: "record_failed" }, { status: 500 });
  }

  // Closes the "request more info" loop (2026-08-16) -- if this upload
  // resolves any open info_requests, that already notified exactly the
  // right people (info-requests.ts's resolveOpenInfoRequests), more
  // precisely than the generic "notify whoever can currently act on this
  // status" heuristic below. Only fall back to that heuristic when
  // nothing was actually outstanding (e.g. the BFP payment-proof case --
  // an unprompted upload nobody formally asked for).
  const resolvedCount = await resolveOpenInfoRequests(supabase, application.id, application.lgu_id, newDocument.id);
  if (resolvedCount > 0) {
    if (business.owner?.phone) {
      await notifyApplicantSms(
        application.id,
        application.lgu_id,
        business.owner.phone,
        `your document for application ${application.reference_number} was received and sent back for review.`
      );
    }
  } else {
    await notifyCurrentOwner(supabase, application, business, documentType);
  }

  return NextResponse.json({ ok: true });
}

/**
 * CLAUDE.md 7w -- the BFP payment-screenshot case (section 7c) is the
 * motivating one, but this fires for any additional-document upload:
 * whoever can currently act on the application should hear about it
 * immediately, not discover it by re-opening a card they'd already
 * reviewed. "Whoever can currently act" depends on where the application
 * actually sits right now:
 *   - pending_dept_review: only the department(s) still pending in the
 *     MOST RECENT round -- a department that already approved doesn't
 *     need to be told about a document that arrived after their decision.
 *   - pending_bplo_initial / pending_bplo_assessment: BPLO.
 *   - pending_payment: Treasury.
 *   - anything else (pending_printing/mayor/release, released, returned):
 *     BPLO as a fallback, since rule #9 already gives them visibility and
 *     action rights everywhere else in the pipeline.
 */
async function notifyCurrentOwner(
  supabase: ReturnType<typeof createServiceClient>,
  application: { id: string; lgu_id: string; status: string; reference_number: string },
  business: { business_name: string; owner?: { full_name: string | null } | null } | null,
  documentType: string
) {
  const businessName = business?.business_name ?? "(business record missing)";
  const ownerName = business?.owner?.full_name ?? "Unknown owner";
  const subject = `Document uploaded: ${application.reference_number}`;
  const emailHtml = `<p><strong>${businessName}</strong> (Owner: ${ownerName}) -- applicant uploaded a new document (${documentType}).</p><p>Application: ${application.reference_number}</p>`;
  const smsMessage = `${businessName} (${application.reference_number}) uploaded a new document (${documentType}).`;

  if (application.status === "pending_dept_review") {
    const { data: latestRound } = await supabase
      .from("review_rounds")
      .select("id")
      .eq("application_id", application.id)
      .order("round_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latestRound) return;
    const { data: pending } = await supabase
      .from("department_reviews")
      .select("department")
      .eq("review_round_id", latestRound.id)
      .eq("decision", "pending");
    for (const p of pending ?? []) {
      await notifyStaffByRole(application.lgu_id, "department", application.id, subject, emailHtml, smsMessage, p.department);
    }
    return;
  }

  const role = application.status === "pending_payment" ? "treasury" : "bplo";
  await notifyStaffByRole(application.lgu_id, role, application.id, subject, emailHtml, smsMessage);
}
