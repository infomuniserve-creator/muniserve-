"use server";

import { getCurrentStaff } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const VALID_ROLES = new Set(["bplo", "treasury", "mayor", "department"]);

/**
 * BPLO provisions a new staff account by email (CLAUDE.md section 7l).
 * auth_user_id starts null -- there's no Supabase auth_user_id to give
 * this row until that person actually signs in with Google at least
 * once; /auth/callback/route.ts claims it automatically on their first
 * real sign-in, matched by email. Uses BPLO's own RLS-scoped session
 * (migration 0015's insert policy enforces the role/lgu_id check for
 * real, not just this action's own staff.role check).
 */
export async function addStaffMember(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "");
  const department = String(formData.get("department") ?? "").trim() || null;

  if (!email || !VALID_ROLES.has(role)) throw new Error("Invalid request");
  if (role === "department" && !department) throw new Error("A department must be selected for a department role");

  const supabase = await createClient();
  const { error } = await supabase.from("staff_users").insert({
    lgu_id: staff.lgu_id,
    full_name: fullName || null,
    email,
    role,
    department: role === "department" ? department : null,
    is_active: true,
  });
  if (error) {
    // Postgres unique_violation on staff_users_email_key (migration 0015)
    throw error.code === "23505" ? new Error("A staff account with that email already exists") : error;
  }

  revalidatePath("/dashboard/staff");
}

/**
 * Activate/deactivate -- never a hard delete, matching the rest of this
 * schema's soft-delete convention. Guards against locking out staff
 * management entirely: BPLO is the only role that can provision staff
 * (this page), so deactivating the last active BPLO account at an LGU
 * would mean nobody left with a UI path to reactivate anyone, ever
 * (back to needing direct database access -- exactly the gap this
 * feature closes). Checked here, not just left to RLS, since RLS has no
 * way to express "not the last one."
 */
export async function setStaffActive(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const staffId = String(formData.get("staffId"));
  const isActive = formData.get("isActive") === "true";

  const supabase = await createClient();

  if (!isActive) {
    const { data: target } = await supabase.from("staff_users").select("role").eq("id", staffId).single();
    if (target?.role === "bplo") {
      const { count } = await supabase
        .from("staff_users")
        .select("id", { count: "exact", head: true })
        .eq("lgu_id", staff.lgu_id)
        .eq("role", "bplo")
        .eq("is_active", true);
      if ((count ?? 0) <= 1) {
        throw new Error("Can't deactivate the last active BPLO account -- activate another BPLO account first");
      }
    }
  }

  const { error } = await supabase.from("staff_users").update({ is_active: isActive }).eq("id", staffId).eq("lgu_id", staff.lgu_id);
  if (error) throw error;

  revalidatePath("/dashboard/staff");
}
