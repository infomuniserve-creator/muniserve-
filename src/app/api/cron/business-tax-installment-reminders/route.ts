import { createServiceClient } from "@/lib/supabase/service";
import { notifyApplicantEmail, notifyApplicantSms } from "@/lib/notifications";
import { getLguDisplay } from "@/lib/lgu";
import { firstNameOf, renderApplicantEmailHtml } from "@/lib/applicant-email-template";
import { NextResponse } from "next/server";

/**
 * Business Tax installment reminders (2026-08-19, CLAUDE.md) -- sends the
 * one-time reminder rows finalizeAssessment (bplo/actions.ts) scheduled
 * for a Bi-Annual/Quarterly application. Reminder-only, per the project
 * owner's own explicit choice: this cron never records or tracks an
 * actual payment, just notifies. Runs daily via vercel.json's cron entry,
 * same CRON_SECRET auth as department-reminders/cleanup-orphaned-uploads
 * -- without it this would be a public, unauthenticated way to spam every
 * applicant on an installment plan.
 *
 * Deliberately per-row try/catch (matching cleanup-orphaned-uploads' own
 * resilience shape) -- one bad row (a deleted application, a missing
 * owner) must never stop every other applicant's reminder for the day
 * from going out.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: due, error } = await supabase
    .from("business_tax_reminders")
    .select("id, application_id, lgu_id, amount")
    .is("sent_at", null)
    .lte("reminder_date", today);
  if (error) {
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  let sentCount = 0;
  for (const reminder of due ?? []) {
    try {
      const { data: application } = await supabase
        .from("applications")
        .select("reference_number, business:businesses(business_name, owner:owners(phone, email, full_name))")
        .eq("id", reminder.application_id)
        .maybeSingle();
      if (!application) continue;

      const business = application.business as unknown as {
        business_name: string;
        owner: { phone: string | null; email: string | null; full_name: string | null } | null;
      } | null;
      const owner = business?.owner;
      const amountText = Number(reminder.amount).toLocaleString();
      const businessName = business?.business_name ?? "your business";

      if (owner?.phone) {
        await notifyApplicantSms(
          reminder.application_id,
          reminder.lgu_id,
          owner.phone,
          `Your next Business Tax installment for ${application.reference_number} (${businessName}) is due: PHP ${amountText}. Pay at the Treasurer's Office.`
        );
        sentCount++;
      }
      if (owner?.email) {
        const lgu = await getLguDisplay(supabase, reminder.lgu_id);
        const html = renderApplicantEmailHtml({
          lgu,
          officeLabel: "Office of the Municipal Treasurer",
          greetingName: firstNameOf(owner.full_name),
          bodyHtml: `<p style="margin:0;">This is a reminder that the next Business Tax installment for <strong>${application.reference_number}</strong> (${businessName}) is now due: <strong>₱${amountText}</strong>. Please pay at the Treasurer's Office to stay current.</p>`,
        });
        await notifyApplicantEmail(reminder.application_id, owner.email, `Business Tax installment due — ${application.reference_number}`, html);
      }

      // Marked sent whether or not the owner had a phone/email on file --
      // otherwise a business with neither would keep re-processing forever.
      await supabase.from("business_tax_reminders").update({ sent_at: new Date().toISOString() }).eq("id", reminder.id);
    } catch (err) {
      console.error("Business tax reminder failed", reminder.id, err);
    }
  }

  return NextResponse.json({ due: due?.length ?? 0, sent: sentCount });
}
