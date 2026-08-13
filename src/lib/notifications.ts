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
 */
async function log(
  applicationId: string | null,
  channel: "sms" | "email",
  recipient: string,
  message: string,
  status: "sent" | "failed"
) {
  const supabase = createServiceClient();
  await supabase.from("notifications_log").insert({ application_id: applicationId, channel, recipient, message, status });
}

/** Applicant-facing notifications are always SMS -- phone is the applicant's actual identity in this system (OTP-based), not email. */
export async function notifyApplicantSms(applicationId: string, phone: string, message: string): Promise<void> {
  try {
    await sendSms(phone, message);
    await log(applicationId, "sms", phone, message, "sent");
  } catch {
    await log(applicationId, "sms", phone, message, "failed").catch(() => {});
  }
}

/** Staff-facing notifications (BPLO alerts, department reminders) go by email -- staff already have one on file via Google OAuth (staff_users.email). */
export async function notifyStaffEmail(applicationId: string | null, email: string, subject: string, html: string): Promise<void> {
  try {
    await sendEmail(email, subject, html);
    await log(applicationId, "email", email, subject, "sent");
  } catch {
    await log(applicationId, "email", email, subject, "failed").catch(() => {});
  }
}
