/**
 * Resend email client (https://resend.com) -- CLAUDE.md's chosen email
 * provider. Used here for staff-facing notifications (department
 * reminders, BPLO alerts on a department rejection/request-for-info) --
 * applicants are notified by SMS instead (src/lib/semaphore.ts), matching
 * how the rest of the applicant flow is phone-first, not email-first.
 * Server-only: uses RESEND_API_KEY, never exposed to the browser.
 *
 * RESEND_FROM_EMAIL must be an address on a domain actually verified in
 * the project's Resend account (Domains tab) -- there's no way to
 * confirm that from code, so it's read from env rather than a guessed
 * domain baked in here. See .env.local's placeholder value/comment.
 *
 * `attachments` (added for the Order of Payment email, CLAUDE.md) uses
 * Resend's own REST shape directly -- `content` is the file's raw bytes,
 * base64-encoded, no separate upload step.
 */
export type EmailAttachment = { filename: string; content: string };

export async function sendEmail(to: string, subject: string, html: string, attachments?: EmailAttachment[]): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    throw new Error("RESEND_FROM_EMAIL is not set -- set it once a sending domain is verified in Resend");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to, subject, html, ...(attachments?.length ? { attachments } : {}) }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend send failed (${response.status}): ${body}`);
  }
}
