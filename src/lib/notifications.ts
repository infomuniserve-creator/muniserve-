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

/** Staff-facing notifications (BPLO alerts, department reminders) go by email -- staff already have one on file via Google OAuth (staff_users.email). */
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
