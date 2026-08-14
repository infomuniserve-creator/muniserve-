"use server";

import { getCurrentPlatformAdmin } from "@/lib/platform-admin";
import { notifyStaffEmail } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const SUBDOMAIN_RE = /^[a-z0-9-]+$/;
const VIEW_AS_ROLES = new Set(["bplo", "treasury", "mayor"]);

/**
 * Platform admin onboards a new client LGU (CLAUDE.md section 7o) --
 * closes the gap the project owner asked about directly: "do I not have
 * my own login where I can onboard a new client." Creates the lgus row
 * (with its own subdomain -- see src/lib/lgu.ts's resolveLguId), any
 * departments named, and a bootstrap BPLO staff_users row so there's
 * someone who can actually use the system once it exists (mirrors how
 * San Miguel's first BPLO account was seeded directly). Uses the
 * platform admin's own RLS-scoped session -- migration 0018's "platform
 * admins manage lgus/lgu_departments/staff_users" policies enforce the
 * role check for real, not just this action's own guard.
 *
 * Deliberately does NOT seed fee_rules -- those need the LGU's actual
 * ordinance (CLAUDE.md 7a/7b's whole point: never guess a real peso
 * amount), which isn't something a generic form can safely collect.
 * That stays a separate, bespoke step per client.
 *
 * The first BPLO account is optional (CLAUDE.md 7o follow-up) -- the
 * project owner often creates and wants to test-drive a client's account
 * (via "View as", below) before they have that client's actual BPLO
 * email in hand, sometimes not until they're physically at that office.
 * Requiring it up front would block onboarding on a detail that isn't
 * always available yet. When it's left blank, no staff_users row or
 * welcome email is created at all -- add the real one later from
 * /dashboard/staff (reachable via "View as BPLO" for this LGU) once it's
 * known, exactly the same self-service flow as adding anyone else.
 */
export async function createLguClient(formData: FormData) {
  const admin = await getCurrentPlatformAdmin();
  if (!admin) throw new Error("Not authorized");

  const name = String(formData.get("name") ?? "").trim();
  const province = String(formData.get("province") ?? "").trim() || null;
  const subdomain = String(formData.get("subdomain") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("displayName") ?? "").trim() || null;
  const bploOfficeName = String(formData.get("bploOfficeName") ?? "").trim() || null;
  const departments = String(formData.get("departments") ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const bploName = String(formData.get("bploName") ?? "").trim();
  const bploEmail = String(formData.get("bploEmail") ?? "").trim().toLowerCase();

  if (!name || !subdomain) throw new Error("Name and subdomain are required");
  if (!SUBDOMAIN_RE.test(subdomain)) throw new Error("Subdomain can only contain lowercase letters, numbers, and hyphens");

  const supabase = await createClient();

  const { data: lgu, error: lguError } = await supabase
    .from("lgus")
    .insert({ name, province, subdomain, display_name: displayName, bplo_office_name: bploOfficeName })
    .select("id")
    .single();
  if (lguError || !lgu) {
    throw lguError?.code === "23505" ? new Error("That subdomain or name is already in use") : (lguError ?? new Error("Failed to create the LGU"));
  }

  if (departments.length > 0) {
    const { error: deptError } = await supabase
      .from("lgu_departments")
      .insert(departments.map((d) => ({ lgu_id: lgu.id, name: d, display_name: d })));
    if (deptError) throw deptError;
  }

  if (bploEmail) {
    const { error: bploError } = await supabase.from("staff_users").insert({
      lgu_id: lgu.id,
      full_name: bploName || null,
      email: bploEmail,
      role: "bplo",
      is_active: true,
    });
    if (bploError) {
      throw bploError.code === "23505" ? new Error("That BPLO email is already registered as staff somewhere") : bploError;
    }

    // Points at the shared /login, not the new subdomain -- staff routing
    // is entirely based on their own staff_users.lgu_id, not which domain
    // they signed in from, so there's no need to wait on the subdomain's
    // own DNS/Vercel setup before this person can start working.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const greeting = bploName ? `Hi ${bploName},` : "Hi,";
    await notifyStaffEmail(
      null,
      bploEmail,
      "Welcome to MuniServe",
      `<p>${greeting}</p>
       <p>A MuniServe account for <strong>${name}</strong> has been set up, and you've been added as its first BPLO administrator.</p>
       <p>Sign in here using your Google account at this email address (<strong>${bploEmail}</strong>) -- no password needed:</p>
       <p><a href="${appUrl}/login">${appUrl}/login</a></p>
       <p>Once signed in, you can add the rest of your team from the Staff page.</p>`
    );
  }

  revalidatePath("/admin");
}

/**
 * "View as" a chosen role at a chosen client LGU -- lets a platform admin
 * troubleshoot any client's real dashboard (applications, businesses,
 * payments, permits, department queues) without ever being added to that
 * LGU's own staff roster, now or in the future (CLAUDE.md 7o follow-up).
 *
 * Upserts a single reusable staff_users "proxy" row for this platform
 * admin (migration 0019) rather than inserting a new one per LGU/role --
 * getCurrentStaff() expects at most one row per auth_user_id. The row is
 * a real staff_users row with the admin's own real auth_user_id, so every
 * existing staff-scoped RLS policy (applications/businesses/payments/
 * permits/department_reviews/...) already grants it exactly the access a
 * genuine staff member at that LGU would have -- no new policies needed
 * on any of those tables.
 *
 * `viewAs` is either a plain role ("bplo"/"treasury"/"mayor") or
 * "department:<name>" -- encodes the department picker into one <select>
 * so this plain-forms page (no client JS) doesn't need a second,
 * conditionally-shown dropdown.
 */
export async function viewAsLgu(formData: FormData) {
  const admin = await getCurrentPlatformAdmin();
  if (!admin) throw new Error("Not authorized");

  const lguId = String(formData.get("lguId") ?? "");
  const viewAs = String(formData.get("viewAs") ?? "");
  if (!lguId || !viewAs) throw new Error("Invalid request");

  let role: string;
  let department: string | null = null;
  if (viewAs.startsWith("department:")) {
    role = "department";
    department = viewAs.slice("department:".length);
    if (!department) throw new Error("Invalid department");
  } else {
    role = viewAs;
    if (!VIEW_AS_ROLES.has(role)) throw new Error("Invalid role");
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) throw new Error("Not authorized");

  const { data: existing } = await supabase
    .from("staff_users")
    .select("id")
    .eq("auth_user_id", authData.user.id)
    .eq("is_admin_proxy", true)
    .maybeSingle();

  const proxyFields = {
    lgu_id: lguId,
    role,
    department,
    full_name: admin.full_name ? `${admin.full_name} (Platform Admin)` : "Platform Admin Support",
    // A synthetic, never-mailed address -- staff_users.email is unique,
    // and this is the same reused row every time, so it only needs to be
    // set once. Kept out of the department-rejection BPLO email fan-out
    // via is_admin_proxy (review-workflow.ts), so nothing ever tries to
    // actually send to it.
    email: `admin-proxy+${admin.id}@internal.muniserve.ph`,
    is_active: true,
    is_admin_proxy: true,
    auth_user_id: authData.user.id,
  };

  const { error } = existing
    ? await supabase.from("staff_users").update(proxyFields).eq("id", existing.id)
    : await supabase.from("staff_users").insert(proxyFields);
  if (error) throw error;

  redirect("/dashboard");
}

/**
 * Deactivates (never deletes -- same soft-delete convention as everywhere
 * else) the platform admin's own "view as" proxy row. Needed for real:
 * getCurrentStaff() (src/lib/staff.ts) now prefers an *active* admin-proxy
 * row over a real staff account on the same Google login, so a platform
 * admin who also happens to be genuine client staff somewhere (hit in
 * production with info.muniserve@gmail.com, already a real San Miguel
 * BPLO account from earlier testing) needs an explicit way back to their
 * own account rather than staying stuck "viewing as" whatever they last
 * picked.
 */
export async function exitViewAs() {
  const admin = await getCurrentPlatformAdmin();
  if (!admin) throw new Error("Not authorized");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) throw new Error("Not authorized");

  const { error } = await supabase
    .from("staff_users")
    .update({ is_active: false })
    .eq("auth_user_id", authData.user.id)
    .eq("is_admin_proxy", true);
  if (error) throw error;

  // Not /admin unconditionally -- if this admin also has their own real
  // staff account, this sends them there normally; if not,
  // dashboard/page.tsx's own fallback lands them on /admin anyway.
  redirect("/dashboard");
}
