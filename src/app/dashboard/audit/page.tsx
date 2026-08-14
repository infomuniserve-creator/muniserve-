import { getCurrentStaff, officeIdentity } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { fetchAllRows } from "@/lib/db-pagination";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "../sign-out-button";
import { DashboardTopBar, SectionHead } from "../ui";
import { AuditTrailTable, type AuditLogRow } from "./audit-trail-table";

/**
 * The system-wide activity/audit trail (CLAUDE.md 7o follow-up) -- the
 * project owner asked for this directly with DILG compliance in mind:
 * every meaningful state change (application received, BPLO's initial
 * review, each department's decision with notes, fee overrides, payments,
 * printing, the Mayor's signature, release, staff account changes, even
 * the client's own pause/resume history) in one chronological, exportable
 * feed, not scattered across six different tables' own audit columns.
 *
 * BPLO and Mayor only, not every staff role (rule #8: a department
 * shouldn't see another department's queue, and this feed necessarily
 * crosses every department at once) -- the project owner explicitly asked
 * for Mayor to see this alongside BPLO.
 *
 * Deliberately no per-application inline "Activity" section on the
 * review cards themselves (bplo/page.tsx already has several different
 * card renderers across its queues) -- every logged event's summary
 * consistently includes the application's own reference number, so
 * searching this one page for e.g. "MS-2026-00001" already answers "what
 * happened to this specific application," without duplicating a timeline
 * UI across every card type.
 *
 * Defaults to the last 90 days (widened via the date pickers) rather than
 * the LGU's entire history unconditionally -- this table only grows, and
 * most real look-ups (including DILG's) are about a recent period, not
 * "since the beginning of time."
 */
export default async function AuditTrailPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "bplo" && staff.role !== "mayor") redirect("/dashboard");

  const office = officeIdentity(staff);
  const supabase = await createClient();
  const lgu = await getLguDisplay(supabase, staff.lgu_id);

  const params = await searchParams;
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 90);
  const from = params.from || defaultFrom.toISOString().slice(0, 10);
  const to = params.to || now.toISOString().slice(0, 10);
  // End-of-day for the "to" bound so the current day's own events aren't excluded.
  const toBound = `${to}T23:59:59.999Z`;

  const rows = await fetchAllRows<AuditLogRow>((offset, limit) =>
    supabase
      .from("audit_log")
      .select("id, application_id, actor_role, actor_label, action, summary, details, created_at", { count: "exact" })
      .eq("lgu_id", staff.lgu_id)
      .gte("created_at", `${from}T00:00:00.000Z`)
      .lte("created_at", toBound)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)
  );

  return (
    <>
      <DashboardTopBar
        officeLabel={office.label}
        officeSub={`${lgu.name}, ${lgu.province}`}
        initials={office.initials}
        active="audit"
        applicationsHref={office.homeHref}
        staffHref={staff.role === "bplo" ? "/dashboard/staff" : undefined}
        settingsHref={staff.role === "bplo" ? "/dashboard/settings" : undefined}
        auditHref="/dashboard/audit"
        statsHref="/dashboard/stats"
        rightSlot={<SignOutButton />}
      />

      <SectionHead
        title="Audit Trail"
        sub="Every application event, department decision, payment, and staff/account change at your LGU, in order. Useful for DILG reporting and internal review alike."
      />
      <AuditTrailTable rows={rows} from={from} to={to} />
    </>
  );
}
