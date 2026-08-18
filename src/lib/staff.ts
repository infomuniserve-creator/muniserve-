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
 * Same as getCurrentStaff(), plus an is_paused check -- for every STATE-
 * CHANGING server action, not for pages/layouts. Audit finding
 * (2026-08-17): Pause (CLAUDE.md 7o) only ever blocked a fresh page load
 * (dashboard/layout.tsx's own render-time check) and new applicant
 * submissions -- every actual server action had no runtime pause check
 * at all, so a staff member with an already-open tab from before the
 * pause could keep approving/paying/signing indefinitely through it,
 * since neither RLS nor any action file ever looks at is_paused.
 *
 * Deliberately NOT folded into getCurrentStaff() itself -- that function
 * is also what dashboard/layout.tsx calls to decide whether to render
 * PausedNotice in the first place; if it silently returned null for a
 * paused real staff member, the layout's own `if (staff) {...}` branch
 * (where the PausedNotice check lives) would never run, and a paused
 * visitor would fall through to whatever a page's own getCurrentStaff()
 * call does next (usually a redirect to /login) instead of ever seeing
 * "Your account is currently Paused." A second, narrower function for
 * actions specifically avoids that regression while still closing the
 * real gap -- every state-changing action swaps its `getCurrentStaff()`
 * call for this one, a mechanical one-line change per action.
 *
 * Exempts a platform admin's "view as" proxy row, same reasoning as
 * dashboard/layout.tsx's own exemption -- they still need to be able to
 * act on a paused client's behalf while troubleshooting it.
 */
export async function requireUnpausedStaff(): Promise<CurrentStaff | null> {
  const staff = await getCurrentStaff();
  if (!staff || staff.is_admin_proxy) return staff;

  const supabase = await createClient();
  const { data: lgu } = await supabase.from("lgus").select("is_paused").eq("id", staff.lgu_id).maybeSingle();
  if (lgu?.is_paused) return null;

  return staff;
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
