import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client for Server Components, Server Actions, and
 * Route Handlers. Reads the caller's session from cookies, so queries run
 * as that authenticated staff member — RLS (migration 0002) does the real
 * access-control work, this client just carries their identity to Postgres.
 *
 * Never use the service_role key here. Server-side applicant API routes
 * (build order step 5) are the only place that key belongs, per CLAUDE.md
 * section 4's trust-boundary split.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component that can't set cookies directly
            // (e.g. rendering a page, not handling a request). Safe to
            // ignore here because middleware.ts refreshes the session on
            // every request anyway.
          }
        },
      },
    }
  );
}
