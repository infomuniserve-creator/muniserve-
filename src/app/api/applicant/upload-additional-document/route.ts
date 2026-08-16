import { getApplicantOwnerId } from "@/lib/applicant-session";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyStaffByRole } from "@/lib/notifications";
import { NextResponse } from "next/server";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

/**
 * Uploads a document to an ALREADY-SUBMITTED application -- the BFP
 * payment-proof screenshot (CLAUDE.md section 7c) being the motivating
 * case, but generally reusable for anything a department asks for after
 * the fact. Unlike upload-document (used during initial submission,
 * before an application row exists), this one requires the application
 * to already exist and belong to the caller's own owner -- verified via
 * the business -> owner chain, not just the storage-path-prefix trick
 * upload-document uses for orphaned pre-submission documents.
 */
export async function POST(request: Request) {
  const ownerId = await getApplicantOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const documentType = String(formData?.get("documentType") ?? "");
  const applicationId = String(formData?.get("applicationId") ?? "");

  if (!(file instanceof File) || !documentType || !applicationId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "unsupported_file_type" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: application, error: fetchError } = await supabase
    .from("applications")
    .select("id, lgu_id, status, reference_number, business:businesses(business_name, owner_id)")
    .eq("id", applicationId)
    .maybeSingle();
  const business = application?.business as unknown as { business_name: string; owner_id: string | null } | null;
  if (fetchError || !application || business?.owner_id !== ownerId) {
    return NextResponse.json({ error: "not_found_or_not_yours" }, { status: 403 });
  }

  const extension = file.name.split(".").pop() || "bin";
  const storagePath = `${ownerId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("application-documents")
    .upload(storagePath, file, { contentType: file.type });
  if (uploadError) {
    console.error("Storage upload failed", uploadError);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }

  const { error: insertError } = await supabase
    .from("documents")
    .insert({ application_id: applicationId, document_type: documentType, file_url: storagePath });
  if (insertError) {
    return NextResponse.json({ error: "record_failed" }, { status: 500 });
  }

  await notifyCurrentOwner(supabase, application, business, documentType);

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
  business: { business_name: string } | null,
  documentType: string
) {
  const subject = `Document uploaded: ${application.reference_number}`;
  const emailHtml = `<p><strong>${business?.business_name ?? "(business record missing)"}</strong> (${application.reference_number}) -- applicant uploaded a new document (${documentType}).</p>`;
  const smsMessage = `${business?.business_name ?? "Applicant"} (${application.reference_number}) uploaded a new document (${documentType}).`;

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
