import { getApplicantOwnerId } from "@/lib/applicant-session";
import { createServiceClient } from "@/lib/supabase/service";
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
    .select("id, business:businesses(owner_id)")
    .eq("id", applicationId)
    .maybeSingle();
  const business = application?.business as unknown as { owner_id: string | null } | null;
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

  return NextResponse.json({ ok: true });
}
