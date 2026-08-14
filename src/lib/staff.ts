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
 *
 * A platform admin who has clicked "View as" (CLAUDE.md 7o follow-up,
 * migration 0019) can legitimately own TWO staff_users rows for the same
 * auth_user_id at once if that same Google account also happens to be
 * real client staff somewhere (a real, hit-in-production case -- caught
 * live when info.muniserve@gmail.com, already a genuine San Miguel BPLO
 * account from earlier testing, tried "View as" and got silently bounced
 * back to /admin). A bare .maybeSingle() errors on more than one row,
 * which getCurrentStaff() then swallowed as "not staff at all" -- fetch
 * every matching row instead and pick deterministically: the active
 * admin-proxy row always wins over a real account, so "View as" reliably
 * takes effect; once it's deactivated (viewAsLgu's exitViewAs), the same
 * person's own real account works normally again.
 */
export async function getCurrentStaff(): Promise<CurrentStaff | null> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return null;

  const { data: rows, error } = await supabase
    .from("staff_users")
    .select("id, lgu_id, full_name, email, role, department, is_active, is_admin_proxy")
    .eq("auth_user_id", authData.user.id);
  if (error || !rows || rows.length === 0) return null;

  const activeProxy = rows.find((r) => r.is_admin_proxy && r.is_active);
  if (activeProxy) return activeProxy as CurrentStaff;

  const real = rows.find((r) => !r.is_admin_proxy);
  if (real && real.is_active) return real as CurrentStaff;

  return null;
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
