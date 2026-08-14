"use server";

import { getCurrentStaff } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { notifyStaffEmail } from "@/lib/notifications";
import { actorLabelFor, logAuditEvent } from "@/lib/audit-log";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const VALID_ROLES = new Set(["bplo", "treasury", "mayor", "department"]);

const ROLE_LABEL: Record<string, string> = {
  bplo: "BPLO",
  treasury: "Treasury",
  mayor: "Mayor's Office",
  department: "Department",
};

/**
 * BPLO provisions a new staff account by email (CLAUDE.md section 7l).
 * auth_user_id starts null -- there's no Supabase auth_user_id to give
 * this row until that person actually signs in with Google at least
 * once; /auth/callback/route.ts claims it automatically on their first
 * real sign-in, matched by email. Uses BPLO's own RLS-scoped session
 * (migration 0015's insert policy enforces the role/lgu_id check for
 * real, not just this action's own staff.role check).
 *
 * Emails the new hire a sign-in link right after (CLAUDE.md section 7m
 * follow-up) -- without it, BPLO would have to separately message every
 * new hire themselves just to tell them the URL and that they don't need
 * a password. Best-effort via notifyStaffEmail (never throws, logs to
 * notifications_log) -- a Resend hiccup shouldn't undo a staff account
 * that was actually created.
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

  const lgu = await getLguDisplay(supabase, staff.lgu_id);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const loginUrl = `${appUrl}/login`;
  const roleLabel = role === "department" ? `${department} Department` : ROLE_LABEL[role];
  const greeting = fullName ? `Hi ${fullName},` : "Hi,";
  await notifyStaffEmail(
    null,
    email,
    "You've been added to MuniServe",
    `<p>${greeting}</p>
     <p>You've been added as <strong>${roleLabel}</strong> staff on MuniServe, ${lgu.displayName}'s business permit system.</p>
     <p>Sign in here using your Google account at this email address (<strong>${email}</strong>) -- no password needed:</p>
     <p><a href="${loginUrl}">${loginUrl}</a></p>`
  );

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "staff_added",
    summary: `Staff account added: ${fullName || email} (${roleLabel})`,
    details: { email, role, department },
  });

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

  const { data: target } = await supabase.from("staff_users").select("role, full_name, email").eq("id", staffId).single();

  if (!isActive) {
    if (target?.role === "bplo") {
      const { count } = await supabase
        .from("staff_users")
        .select("id", { count: "exact", head: true })
        .eq("lgu_id", staff.lgu_id)
        .eq("role", "bplo")
        .eq("is_active", true)
        // A platform admin's "view as BPLO" proxy row (CLAUDE.md 7o
        // follow-up) must never count as real BPLO coverage here -- it
        // isn't staffed by anyone on the client's own team, and could
        // otherwise let the last real BPLO be deactivated while an admin
        // just happens to be viewing that LGU.
        .eq("is_admin_proxy", false);
      if ((count ?? 0) <= 1) {
        throw new Error("Can't deactivate the last active BPLO account -- activate another BPLO account first");
      }
    }
  }

  const { error } = await supabase.from("staff_users").update({ is_active: isActive }).eq("id", staffId).eq("lgu_id", staff.lgu_id);
  if (error) throw error;

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: isActive ? "staff_activated" : "staff_deactivated",
    summary: `Staff account ${isActive ? "activated" : "deactivated"}: ${target?.full_name || target?.email || staffId}`,
  });

  revalidatePath("/dashboard/staff");
}
