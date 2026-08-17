import { getApplicantOwnerId } from "@/lib/applicant-session";
import { ALLOWED_TYPES, DOCUMENT_BUCKET } from "@/lib/document-upload";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

/**
 * Issues a signed Supabase Storage upload URL so the browser can PUT a
 * document's bytes directly to Storage -- bypassing this (and every other
 * Vercel serverless function) entirely for the actual file transfer.
 * Replaces routing the file through upload-document.ts/upload-additional-
 * document.ts directly, after confirming (2026-08-17) that Vercel's own
 * function request body limit sits between 4MB and 4.5MB regardless of
 * what MAX_FILE_BYTES said -- well under what a real multi-page scanned
 * government document commonly needs.
 *
 * The returned path is scoped under the caller's own ownerId, matching the
 * existing storage-path-prefix ownership convention -- upload-document.ts
 * and upload-additional-document.ts both re-check this prefix, plus that
 * the object actually exists at the claimed size, before trusting
 * anything the client says was uploaded.
 */
export async function POST(request: Request) {
  const ownerId = await getApplicantOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const contentType = String(body?.contentType ?? "");
  const fileName = String(body?.fileName ?? "file");
  if (!ALLOWED_TYPES.includes(contentType)) {
    return NextResponse.json({ error: "unsupported_file_type" }, { status: 400 });
  }

  const extension = fileName.split(".").pop() || "bin";
  const path = `${ownerId}/${crypto.randomUUID()}.${extension}`;

  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ error: "could_not_create_upload_url" }, { status: 500 });
  }

  return NextResponse.json({ path: data.path, token: data.token });
}
