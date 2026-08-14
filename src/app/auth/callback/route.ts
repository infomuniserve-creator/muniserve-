import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

/**
 * Google OAuth redirects here with a `code` param. Exchange it for a
 * session, then hand off to /dashboard, which figures out (via
 * getCurrentStaff) whether this Google account is actually provisioned as
 * staff and routes accordingly.
 *
 * Also claims a pre-provisioned staff_users OR platform_admins row by
 * email, if one exists with no auth_user_id yet (CLAUDE.md sections 7l,
 * 7o) -- BPLO adds a new staff member by email through /dashboard/staff,
 * or a platform admin adds a new client's first BPLO through /admin,
 * BEFORE that person has ever signed in (there's no Supabase auth_user_id
 * to give them until they have), so the row starts out unlinked. First
 * real sign-in links whichever one matches automatically. Uses the
 * service-role client since this person isn't recognized as staff/admin
 * yet -- their own session has no RLS access to either table beyond
 * whatever migrations 0015/0018 grant, and this write has to succeed
 * regardless of which one they turn out to be. Case-insensitive match
 * (ilike, no wildcards) since Google's returned email casing doesn't have
 * to match whatever casing was typed when inviting.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      if (data.user.email) {
        const service = createServiceClient();
        await service
          .from("staff_users")
          .update({ auth_user_id: data.user.id })
          .ilike("email", data.user.email)
          .is("auth_user_id", null);
        await service
          .from("platform_admins")
          .update({ auth_user_id: data.user.id })
          .ilike("email", data.user.email)
          .is("auth_user_id", null);
      }
      return NextResponse.redirect(`${origin}/dashboard`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
