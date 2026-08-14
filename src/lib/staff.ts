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
  // true only for a platform admin's "view as" proxy row (CLAUDE.md 7o
  // follow-up, migration 0019) -- lets dashboard/layout.tsx show a banner
  // and lets staff-facing lists/guards exclude it from real client staff.
  is_admin_proxy: boolean;
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
    .select("id, lgu_id, full_name, email, role, department, is_active, is_admin_proxy")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();

  if (error || !data || !data.is_active) return null;
  return data as CurrentStaff;
}

/**
 * The office identity (label, avatar initials, "Applications" home link)
 * shown in every dashboard page's top bar -- including the shared
 * Business Registry page, which needs to show the right office even
 * though it isn't role-specific itself. One place for this instead of
 * four slightly different inline versions (the pre-redesign pages each
 * built their own title/subtitle/initials by hand).
 */
export function officeIdentity(staff: CurrentStaff): { label: string; initials: string; homeHref: string } {
  if (staff.role === "bplo") return { label: "BPLO Office", initials: "BP", homeHref: "/dashboard/bplo" };
  if (staff.role === "treasury") return { label: "Treasury Office", initials: "TR", homeHref: "/dashboard/treasury" };
  if (staff.role === "mayor") return { label: "Mayor's Office", initials: "MO", homeHref: "/dashboard/mayor" };
  const dept = staff.department ?? "Department";
  return { label: `${dept} Office`, initials: dept.slice(0, 2).toUpperCase(), homeHref: "/dashboard/department" };
}
