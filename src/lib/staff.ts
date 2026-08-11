import { createClient } from "@/lib/supabase/server";

export type StaffRole = "bplo" | "treasury" | "mayor" | "department";

export type CurrentStaff = {
  id: string;
  lgu_id: string;
  full_name: string | null;
  email: string | null;
  role: StaffRole;
  department: string | null;
  is_active: boolean;
};

/**
 * The logged-in user's staff_users row, or null if they're authenticated
 * with Google but haven't been provisioned as staff yet (or aren't active).
 * RLS (migration 0002) already limits this query to their own row anyway --
 * this just gives dashboard pages a typed, single place to read it from.
 */
export async function getCurrentStaff(): Promise<CurrentStaff | null> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return null;

  const { data, error } = await supabase
    .from("staff_users")
    .select("id, lgu_id, full_name, email, role, department, is_active")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();

  if (error || !data || !data.is_active) return null;
  return data as CurrentStaff;
}
