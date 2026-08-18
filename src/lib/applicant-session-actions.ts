"use server";

import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { APPLICANT_SESSION_COOKIE_NAME } from "@/lib/applicant-session";

/**
 * Real sign-out, not just a client-side reset -- nothing anywhere ever
 * actually ended this cookie's 30-day life before this. `ApplyPageClient`'s
 * "Start over" only ever reset local React state, and `/status/[reference]`
 * had no sign-out control at all; either way, the session (and the
 * unauthenticated ability to submit a new application under the previous
 * person's owner_id, or view their status pages) stayed live on a shared/
 * public device for the full 30 days regardless of what the UI showed.
 * Deletes the server-side `applicant_sessions` row (a real revoke, not just
 * clearing the cookie -- the token itself must stop working, not merely
 * stop being sent) before clearing the cookie.
 *
 * A separate file with its own top-level "use server" directive, not a
 * function added to applicant-session.ts itself -- that file also exports
 * a plain synchronous helper (applicantSessionCookieOptions) and is
 * imported by ordinary API routes, so it can't carry the file-level
 * directive Next.js requires before a Client Component (ApplyPageClient,
 * the new SignOutButton) can import and call a Server Function directly.
 */
export async function signOutApplicant(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(APPLICANT_SESSION_COOKIE_NAME)?.value;
  if (token) {
    const supabase = createServiceClient();
    await supabase.from("applicant_sessions").delete().eq("session_token", token);
  }
  cookieStore.delete(APPLICANT_SESSION_COOKIE_NAME);
}
