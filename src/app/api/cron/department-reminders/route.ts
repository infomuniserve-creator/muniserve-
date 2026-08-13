import { createServiceClient } from "@/lib/supabase/service";
import { notifyStaffEmail } from "@/lib/notifications";
import { NextResponse } from "next/server";

/**
 * CLAUDE.md section 6: "24-hour reminder to a department reviewer if
 * their department_reviews.decision is still pending, skipping
 * Saturday/Sunday." Triggered by vercel.json's crons entry, once daily.
 * Vercel sends "Authorization: Bearer $CRON_SECRET" automatically when
 * that env var is set (in both this project's env and Vercel's own
 * project settings) -- without it, this route would be a public,
 * unauthenticated way to spam every department with email.
 *
 * "Skipping Saturday/Sunday" is read here as "the whole run does nothing
 * on a weekend" rather than trying to count business hours precisely --
 * a Friday-created pending review that crosses 24 hours on Saturday
 * just waits for Monday's run. Day-of-week is computed in Asia/Manila
 * time (UTC+8, San Miguel's actual timezone), not the server's own UTC
 * day, which can differ by date depending on time of day.
 *
 * The escalation tier CLAUDE.md also describes (notify a department
 * head after N business days) is deliberately NOT implemented here --
 * section 10 explicitly flags that timing as unconfirmed pending the
 * LGU's/counsel's read on RA 11032, and hardcoding a number would be
 * exactly the kind of guess this project's own standing rule warns
 * against. department_reviews.escalated_at exists in the schema
 * (migration 0001) for whenever that number is actually confirmed.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const phNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const dayOfWeek = phNow.getUTCDay(); // 0 = Sunday, 6 = Saturday, computed against the shifted (PH-local) instant
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return NextResponse.json({ skipped: "weekend" });
  }

  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: pending, error } = await supabase
    .from("department_reviews")
    .select("id, department, review_round_id")
    .eq("decision", "pending")
    .is("reminder_sent_at", null)
    .lte("created_at", cutoff);
  if (error) {
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  let remindedCount = 0;
  for (const review of pending ?? []) {
    const { data: round } = await supabase
      .from("review_rounds")
      .select("application_id")
      .eq("id", review.review_round_id)
      .single();
    if (!round) continue;

    const { data: application } = await supabase
      .from("applications")
      .select("reference_number, lgu_id, business:businesses(business_name)")
      .eq("id", round.application_id)
      .single();
    if (!application) continue;

    const { data: deptStaff } = await supabase
      .from("staff_users")
      .select("email")
      .eq("lgu_id", application.lgu_id)
      .eq("role", "department")
      .eq("department", review.department)
      .eq("is_active", true);

    const business = application.business as unknown as { business_name: string } | null;
    const subject = `Reminder: ${review.department} review pending for ${application.reference_number}`;
    const html = `<p><strong>${business?.business_name ?? "(business record missing)"}</strong> (${application.reference_number}) has been awaiting ${review.department}'s review for over 24 hours. Please review at your earliest convenience.</p>`;

    for (const s of deptStaff ?? []) {
      if (s.email) await notifyStaffEmail(round.application_id, s.email, subject, html);
    }

    // Marked whether or not anyone actually got emailed (e.g. no active
    // staff provisioned for that department yet) -- otherwise a
    // provisioning gap turns into re-processing the same row forever.
    await supabase.from("department_reviews").update({ reminder_sent_at: new Date().toISOString() }).eq("id", review.id);
    remindedCount++;
  }

  return NextResponse.json({ reminded: remindedCount });
}
