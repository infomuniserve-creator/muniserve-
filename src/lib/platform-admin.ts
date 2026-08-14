import { createClient } from "@/lib/supabase/server";

export type CurrentPlatformAdmin = {
  id: string;
  email: string;
  full_name: string | null;
};

/**
 * The logged-in user's platform_admins row, or null if they're either not
 * a platform admin at all or have been deactivated -- mirrors
 * getCurrentStaff()'s shape exactly (src/lib/staff.ts), just for the role
 * that sits above LGU-scoped staff (CLAUDE.md section 7o). RLS (migration
 * 0018) already limits this query to their own row.
 */
export async function getCurrentPlatformAdmin(): Promise<CurrentPlatformAdmin | null> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return null;

  const { data, error } = await supabase
    .from("platform_admins")
    .select("id, email, full_name, is_active")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();

  if (error || !data || !data.is_active) return null;
  return data;
}
