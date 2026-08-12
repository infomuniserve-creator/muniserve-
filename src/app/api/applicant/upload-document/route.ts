import { getApplicantOwnerId } from "@/lib/applicant-session";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

/**
 * Uploads one document ahead of final submission, before an `applications`
 * row exists to attach it to (the application form uploads several
 * documents inline, per reference/MuniServe_Applicant_Flow_Prototype.html).
 * The resulting `documents` row is created with application_id = null;
 * submit-application claims it by id once the application is created.
 * Storage path is prefixed with the owner's id so submit-application can
 * verify the caller actually owns an orphaned document before claiming it
 * (documents has no owner_id column of its own -- ownership only exists
 * via application -> business -> owner once claimed, so the storage path
 * is the only ownership signal available before that link exists).
 */
export async function POST(request: Request) {
  const ownerId = await getApplicantOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const documentType = String(formData?.get("documentType") ?? "");

  if (!(file instanceof File) || !documentType) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "unsupported_file_type" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const extension = file.name.split(".").pop() || "bin";
  const storagePath = `${ownerId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("application-documents")
    .upload(storagePath, file, { contentType: file.type });
  if (uploadError) {
    console.error("Storage upload failed", uploadError);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }

  const { data: doc, error: insertError } = await supabase
    .from("documents")
    .insert({ document_type: documentType, file_url: storagePath })
    .select("id")
    .single();
  if (insertError || !doc) {
    return NextResponse.json({ error: "record_failed" }, { status: 500 });
  }

  return NextResponse.json({ documentId: doc.id });
}
