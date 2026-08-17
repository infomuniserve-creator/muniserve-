import { getApplicantOwnerId } from "@/lib/applicant-session";
import { verifyUploadedObject } from "@/lib/document-upload";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

/**
 * Registers a document ahead of final submission, before an `applications`
 * row exists to attach it to (the application form uploads several
 * documents inline, per reference/MuniServe_Applicant_Flow_Prototype.html).
 * The resulting `documents` row is created with application_id = null;
 * submit-application claims it by id once the application is created.
 *
 * The browser already uploaded the file bytes directly to Storage via a
 * signed URL (request-upload-url/route.ts, 2026-08-17) -- this route never
 * sees the file itself, only the `path` it landed at. Storage path is
 * prefixed with the owner's id so this can verify the caller actually owns
 * the object being registered (documents has no owner_id column of its own
 * -- ownership only exists via application -> business -> owner once
 * claimed, so the storage path is the only ownership signal available
 * before that link exists).
 */
export async function POST(request: Request) {
  const ownerId = await getApplicantOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const path = String(body?.path ?? "");
  const documentType = String(body?.documentType ?? "");
  if (!path.startsWith(`${ownerId}/`) || !documentType) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const verified = await verifyUploadedObject(supabase, path);
  if ("error" in verified) {
    return NextResponse.json({ error: verified.error }, { status: 400 });
  }

  const { data: doc, error: insertError } = await supabase
    .from("documents")
    .insert({ document_type: documentType, file_url: path })
    .select("id")
    .single();
  if (insertError || !doc) {
    return NextResponse.json({ error: "record_failed" }, { status: 500 });
  }

  return NextResponse.json({ documentId: doc.id });
}
