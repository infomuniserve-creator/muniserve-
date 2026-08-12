import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client -- bypasses RLS entirely. Per CLAUDE.md
 * section 4's trust-boundary split, this is the ONLY client applicant-
 * facing code should use: applicants have no Supabase Auth session (no
 * auth.uid()) to satisfy the staff-oriented RLS policies in migration
 * 0002, so owners/otp_codes/applicant_sessions are deliberately locked
 * down to deny anon/authenticated access outright. Every applicant API
 * route must do its own authorization check (the signed session cookie)
 * before touching data with this client -- there's no RLS safety net here.
 *
 * Never import this into client components or anything that ends up in
 * the browser bundle. Server-only (route handlers, Server Actions,
 * Server Components) exclusively.
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
