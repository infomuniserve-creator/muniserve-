import { getCurrentStaff } from "@/lib/staff";
import { fetchAllRows } from "@/lib/db-pagination";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SectionHead } from "../ui";
import { AuditTrailExplorer, type AuditAppInfo, type AuditLogRow } from "./audit-trail-table";

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
 * Still deliberately no per-application inline "Activity" section on the
 * review cards themselves (bplo/page.tsx already has several different
 * card renderers across its queues, and duplicating a timeline widget
 * across every one of them is a lot of surface for something that has a
 * real home here). But a flat chronological feed turned out to be the
 * wrong shape for that home -- first shipped as one big table sorted by
 * time, with the expectation that searching a reference number would
 * answer "what happened to this application." Feedback from actually
 * using it: a flat feed answers "what just happened," not "show me this
 * application's story," and a reader has no way to tell which business a
 * given row belongs to without reading the free-text summary. Rebuilt as
 * `AuditTrailExplorer`: applications-with-activity grouped into one row
 * each (reference no., business name, current status, last activity),
 * click to expand that one application's own events in chronological
 * order -- the drill-down the project owner actually asked for. Events
 * with no `application_id` (staff/account changes) have nothing to group
 * under, so they stay a flat list in a separate "Other activity" tab.
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

  const supabase = await createClient();

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

  // The log itself only carries a reference number inside its free-text
  // `summary` -- fetch the actual application/business rows for every
  // application referenced in this date range so the UI can group events
  // by application (reference no., business name, current status) instead
  // of leaving that lookup to the reader. Scoped to `application_id`s that
  // already passed the `lgu_id` filter above, but re-filtered by `lgu_id`
  // here too as defense in depth.
  const appIds = [...new Set(rows.map((r) => r.application_id).filter((id): id is string => !!id))];
  let apps: AuditAppInfo[] = [];
  if (appIds.length > 0) {
    const { data: appRows } = await supabase
      .from("applications")
      .select("id, reference_number, application_type, status, business:businesses(business_name)")
      .eq("lgu_id", staff.lgu_id)
      .in("id", appIds);
    apps = (appRows ?? []).map((a) => {
      const business = Array.isArray(a.business) ? a.business[0] : a.business;
      return {
        id: a.id,
        referenceNumber: a.reference_number,
        applicationType: a.application_type,
        status: a.status,
        businessName: business?.business_name ?? "—",
      };
    });
  }

  return (
    <>
      <SectionHead
        title="Audit Trail"
        sub="Every application's full history, plus staff and account changes at your LGU. Useful for DILG reporting and internal review alike."
      />
      <AuditTrailExplorer rows={rows} apps={apps} from={from} to={to} />
    </>
  );
}
