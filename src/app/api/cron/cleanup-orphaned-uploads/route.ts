import { createServiceClient } from "@/lib/supabase/service";
import { DOCUMENT_BUCKET } from "@/lib/document-upload";
import { NextResponse } from "next/server";

// Purely a technical/operational threshold, not a domain fact -- how long
// to wait before treating an incomplete upload as abandoned rather than
// still-in-progress. Generous on both counts: a real applicant finishes
// the multi-step form in minutes, not days, and the grace window on raw
// Storage objects is well beyond how long a register call could ever
// legitimately take after a successful PUT.
const ORPHANED_DOC_ROW_DAYS = 7;
const ORPHANED_UPLOAD_GRACE_HOURS = 24;

/**
 * Audit finding (2026-08-17): the direct-to-Storage upload flow
 * (request-upload-url/route.ts, built earlier the same day) had no
 * cleanup mechanism at all for two kinds of leftovers, and one of them
 * was already real in production (12 orphaned `documents` rows found at
 * the time of the audit) --
 *
 * 1. `documents` rows created pre-submission (application_id still null,
 *    upload-document.ts) that never got claimed by a completed
 *    submit-application call -- an abandoned form, closed tab, or a
 *    genuinely different business ultimately submitted instead.
 * 2. Storage objects that a real PUT succeeded for, but whose follow-up
 *    "register" call (upload-document.ts / upload-additional-document.ts)
 *    never happened at all -- no `documents` row exists to even show
 *    this one is orphaned; nothing but a real Storage listing can find it.
 *
 * Runs daily via vercel.json's cron entry, same CRON_SECRET auth as
 * department-reminders/route.ts -- without it this would be a public,
 * unauthenticated way to delete real applicant documents.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  let deletedOrphanedDocRows = 0;
  let deletedOrphanedStorageObjects = 0;

  // ---- 1. Orphaned documents rows (never claimed by a submission) ----
  const docRowCutoff = new Date(Date.now() - ORPHANED_DOC_ROW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: orphanedDocs } = await supabase
    .from("documents")
    .select("id, file_url")
    .is("application_id", null)
    .lte("uploaded_at", docRowCutoff);

  for (const doc of orphanedDocs ?? []) {
    await supabase.storage.from(DOCUMENT_BUCKET).remove([doc.file_url]);
    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (!error) deletedOrphanedDocRows++;
  }

  // ---- 2. Storage objects with no documents row at all ----
  // Every real object lives under an owner-id folder (request-upload-url's
  // own path convention, `${ownerId}/${uuid}.${ext}`) -- Storage's list()
  // represents a folder prefix as an entry with `id: null` (no metadata),
  // distinct from a real object (which always has an id). Only ever
  // descends one level, matching that this bucket has no nested structure
  // beyond owner/file by design.
  const { data: knownFileUrls } = await supabase.from("documents").select("file_url");
  const knownSet = new Set((knownFileUrls ?? []).map((d) => d.file_url));
  const graceHoursCutoff = Date.now() - ORPHANED_UPLOAD_GRACE_HOURS * 60 * 60 * 1000;

  const { data: topLevel } = await supabase.storage.from(DOCUMENT_BUCKET).list();
  for (const entry of topLevel ?? []) {
    if (entry.id) continue; // a real object at the bucket root -- shouldn't exist under this bucket's own convention, skip defensively rather than touch something unexpected
    const { data: files } = await supabase.storage.from(DOCUMENT_BUCKET).list(entry.name);
    for (const file of files ?? []) {
      const path = `${entry.name}/${file.name}`;
      if (knownSet.has(path)) continue;
      const uploadedAt = file.created_at ? new Date(file.created_at).getTime() : null;
      if (uploadedAt == null || uploadedAt > graceHoursCutoff) continue; // too recent (or age unknown) -- leave it, might still be mid-flow
      const { error } = await supabase.storage.from(DOCUMENT_BUCKET).remove([path]);
      if (!error) deletedOrphanedStorageObjects++;
    }
  }

  return NextResponse.json({ deletedOrphanedDocRows, deletedOrphanedStorageObjects });
}
