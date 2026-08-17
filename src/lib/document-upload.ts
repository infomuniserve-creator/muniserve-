import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared between server routes and client components (2026-08-17) -- both
 * need the same ceiling/allow-list, and drifting them apart would just
 * recreate the exact mismatch this file replaces (the client used to say
 * "10MB", the server checked 10MB, but Vercel's own function body limit
 * (confirmed empirically: works at 4MB, 413s at 4.5MB) silently capped
 * everything in between at a lower number neither side knew about).
 *
 * Fixed by moving the actual file bytes off Vercel's functions entirely --
 * the browser uploads straight to Supabase Storage via a signed upload URL
 * (request-upload-url/route.ts), so this ceiling only has to satisfy
 * Storage's own limits, not a serverless function's request body limit.
 * Also set as the bucket's own `file_size_limit` (Storage's own enforced
 * ceiling, unspoofable by the client) so this number is authoritative in
 * three places for the same reason, not just documentation.
 */
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB
export const MAX_FILE_MB = MAX_FILE_BYTES / (1024 * 1024);
export const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export const DOCUMENT_BUCKET = "application-documents";

/**
 * Confirms a client's claimed direct-to-storage upload actually happened,
 * at an acceptable size, before trusting it enough to create a `documents`
 * row. The server never sees the file bytes in this flow (that's the
 * point -- see above), so this is the one place size is still enforced
 * server-side: the bucket's own `file_size_limit` should already reject
 * anything oversized at upload time, but this re-checks and deletes
 * anything that somehow slipped through rather than assuming it did.
 */
export async function verifyUploadedObject(
  supabase: SupabaseClient,
  path: string
): Promise<{ ok: true } | { error: "upload_not_found" | "file_too_large" }> {
  const folder = path.split("/")[0];
  const filename = path.slice(folder.length + 1);
  const { data: listing } = await supabase.storage.from(DOCUMENT_BUCKET).list(folder, { search: filename });
  const found = listing?.find((f) => f.name === filename);
  if (!found) {
    return { error: "upload_not_found" };
  }
  const size = (found.metadata as { size?: number } | null)?.size;
  if (typeof size === "number" && size > MAX_FILE_BYTES) {
    await supabase.storage.from(DOCUMENT_BUCKET).remove([path]);
    return { error: "file_too_large" };
  }
  return { ok: true };
}
