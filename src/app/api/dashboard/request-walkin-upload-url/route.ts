import { requireUnpausedStaff } from "@/lib/staff";
import { ALLOWED_TYPES, DOCUMENT_BUCKET } from "@/lib/document-upload";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

/**
 * Signed-upload-URL issuer for BPLO's walk-in flow (2026-08-22) -- the
 * staff-side counterpart to request-upload-url/route.ts. A walk-in
 * application (businesses/actions.ts's startWalkInApplication) opens the
 * department review round immediately with no digitized documents at all
 * (BPLO just vouches for the physical copies) -- this is what lets BPLO
 * attach a scan/photo of what they looked at, so the departments reviewing
 * in parallel aren't deciding blind.
 *
 * Staged under a flat "walkin/" folder, not per-business/per-lgu -- the
 * application doesn't exist yet at upload time (the walk-in form is still
 * one submit away), so there's no id to scope the path by yet. Matches the
 * existing cleanup-orphaned-uploads cron's one-level folder/file traversal
 * unchanged (same shape as the applicant flow's own `${ownerId}/...`
 * convention) -- a file staged here but never actually submitted with the
 * walk-in form is swept by that same cron after its usual grace window,
 * no separate cleanup needed.
 */
export async function POST(request: Request) {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") {
    return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const contentType = String(body?.contentType ?? "");
  const fileName = String(body?.fileName ?? "file");
  if (!ALLOWED_TYPES.includes(contentType)) {
    return NextResponse.json({ error: "unsupported_file_type" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const extension = fileName.split(".").pop() || "bin";
  const path = `walkin/${crypto.randomUUID()}.${extension}`;

  const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ error: "could_not_create_upload_url" }, { status: 500 });
  }

  return NextResponse.json({ path: data.path, token: data.token });
}
