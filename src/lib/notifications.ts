import { sendSms } from "@/lib/semaphore";
import { sendEmail } from "@/lib/resend";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Central place every status-change notification goes through, so
 * they're all logged to notifications_log (migration 0001 -- already had
 * this table and RLS from the very start) the same way, and so a
 * provider failure (bad number, Semaphore/Resend outage) can never block
 * or roll back the workflow action that triggered it. Best-effort by
 * design: log "sent" on success, "failed" on error, never throw either
 * way -- callers fire-and-forget these.
 *
 * errorDetail (migration 0016) exists because the first version of this
 * function didn't capture it anywhere -- a real failure (the first live
 * staff-invite email) logged as "failed" with nothing to look at to find
 * out why, not even a console.error. Every failure is queryable now.
 */
async function log(
  applicationId: string | null,
  channel: "sms" | "email",
  recipient: string,
  message: string,
  status: "sent" | "failed",
  errorDetail?: string
) {
  const supabase = createServiceClient();
  await supabase.from("notifications_log").insert({ application_id: applicationId, channel, recipient, message, status, error_detail: errorDetail ?? null });
}

/** Applicant-facing notifications are always SMS -- phone is the applicant's actual identity in this system (OTP-based), not email. */
export async function notifyApplicantSms(applicationId: string, phone: string, message: string): Promise<void> {
  try {
    await sendSms(phone, message);
    await log(applicationId, "sms", phone, message, "sent");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("notifyApplicantSms failed", detail);
    await log(applicationId, "sms", phone, message, "failed", detail).catch(() => {});
  }
}

/** Staff-facing email -- staff already have one on file via Google OAuth (staff_users.email), guaranteed for every account. */
export async function notifyStaffEmail(applicationId: string | null, email: string, subject: string, html: string): Promise<void> {
  try {
    await sendEmail(email, subject, html);
    await log(applicationId, "email", email, subject, "sent");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("notifyStaffEmail failed", detail);
    await log(applicationId, "email", email, subject, "failed", detail).catch(() => {});
  }
}

/**
 * Staff-facing SMS (CLAUDE.md 7w) -- migration 0031's staff_users.phone,
 * optional and unvalidated at the schema level. Unlike notifyApplicantSms,
 * this is never the only channel a staff member can be reached on (email
 * always exists), so a missing/invalid phone is never a blocker anywhere
 * that calls this -- callers just skip it when a staff row has no phone,
 * same as this function's own best-effort/never-throws shape for the
 * actual send.
 */
export async function notifyStaffSms(applicationId: string | null, phone: string, message: string): Promise<void> {
  try {
    await sendSms(phone, message);
    await log(applicationId, "sms", phone, message, "sent");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("notifyStaffSms failed", detail);
    await log(applicationId, "sms", phone, message, "failed", detail).catch(() => {});
  }
}

/**
 * Notifies every active, non-proxy staff member of a given role (or, for
 * role = "department", a specific department) at an LGU -- both channels
 * at once, email always, SMS only for whoever has a phone on file
 * (CLAUDE.md 7w). Centralizes the "who do I actually notify" lookup that
 * used to be hand-written per call site (notifyDepartmentIssue, the
 * reminder cron) -- every new trigger point this pass adds (new
 * submission, a department round opening, all-departments-cleared,
 * assessment finalized, payment recorded, printed, signed, a document
 * uploaded) needs the identical shape, just a different role/department
 * and message.
 *
 * Uses the service-role client deliberately, same reasoning as
 * notifyDepartmentIssue -- this runs as a side effect of one staff
 * member's action, and has no reason to lean on their own narrower
 * RLS-scoped session to read every other staff member's contact details.
 */
export async function notifyStaffByRole(
  lguId: string,
  role: "bplo" | "treasury" | "mayor" | "department",
  applicationId: string | null,
  subject: string,
  emailHtml: string,
  smsMessage: string,
  department?: string
): Promise<void> {
  if (role === "department" && !department) return;

  const supabase = createServiceClient();
  let query = supabase
    .from("staff_users")
    .select("email, phone")
    .eq("lgu_id", lguId)
    .eq("role", role)
    .eq("is_active", true)
    // Excludes a platform admin's "view as" proxy row (CLAUDE.md 7o
    // follow-up) -- its email is a synthetic, unreachable placeholder and
    // it has no phone, same exclusion notifyDepartmentIssue already applies.
    .eq("is_admin_proxy", false);
  if (role === "department") query = query.eq("department", department!);

  const { data: staffList } = await query;
  for (const s of staffList ?? []) {
    if (s.email) await notifyStaffEmail(applicationId, s.email, subject, emailHtml);
    if (s.phone) await notifyStaffSms(applicationId, s.phone, smsMessage);
  }
}
