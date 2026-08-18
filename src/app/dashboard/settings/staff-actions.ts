"use server";

import { requireUnpausedStaff } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { notifyStaffEmail } from "@/lib/notifications";
import { normalizePhone } from "@/lib/phone";
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
 * Moved from the old standalone /dashboard/staff page into Settings
 * (2026-08-15) -- "Add/Remove Staff" is now the first section there rather
 * than its own top-nav tab, kept as a separate actions file from the rest
 * of settings/actions.ts since staff-account management is its own
 * concern, not LGU-level fee configuration.
 *
 * auth_user_id starts null -- there's no Supabase auth_user_id to give
 * this row until that person actually signs in with Google at least once;
 * /auth/callback/route.ts claims it automatically on their first real
 * sign-in, matched by email. Uses BPLO's own RLS-scoped session
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
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "");
  const department = String(formData.get("department") ?? "").trim() || null;
  const phoneInput = String(formData.get("phone") ?? "").trim();

  if (!email || !VALID_ROLES.has(role)) throw new Error("Invalid request");
  if (role === "department" && !department) throw new Error("A department must be selected for a department role");

  // Optional -- a staff member with no phone on file just never gets an
  // SMS (email still works either way, CLAUDE.md 7w), not a blocker.
  let phone: string | null = null;
  if (phoneInput) {
    phone = normalizePhone(phoneInput);
    if (!phone) throw new Error("That mobile number doesn't look right -- check it and try again.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("staff_users").insert({
    lgu_id: staff.lgu_id,
    full_name: fullName || null,
    email,
    phone,
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

  revalidatePath("/dashboard/settings");
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
  const staff = await requireUnpausedStaff();
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

  revalidatePath("/dashboard/settings");
}

/**
 * Sets or clears a staff member's phone number for SMS notifications
 * (CLAUDE.md 7w) -- the first real "edit an existing staff member" control
 * this page has (everything else so far is add-only plus activate/
 * deactivate, per 7m's own "not full profile editing" scope note). Scoped
 * narrowly on purpose, same "RLS bounds which rows, not which columns"
 * convention as setStaffActive: this action only ever writes the phone
 * column, nothing about role/department/email is touched here.
 */
export async function updateStaffPhone(formData: FormData) {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const staffId = String(formData.get("staffId"));
  const phoneInput = String(formData.get("phone") ?? "").trim();

  let phone: string | null = null;
  if (phoneInput) {
    phone = normalizePhone(phoneInput);
    if (!phone) throw new Error("That mobile number doesn't look right -- check it and try again.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("staff_users").update({ phone }).eq("id", staffId).eq("lgu_id", staff.lgu_id);
  if (error) throw error;

  revalidatePath("/dashboard/settings");
}
