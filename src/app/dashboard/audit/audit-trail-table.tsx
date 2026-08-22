"use client";

import { Fragment, useMemo, useState } from "react";
import { WorkflowStepper, TonePill } from "../ui";

export type AuditLogRow = {
  id: string;
  application_id: string | null;
  actor_role: string | null;
  actor_label: string | null;
  action: string;
  summary: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

/** One row per application referenced anywhere in the fetched date range -- looked up server-side in page.tsx, since audit_log itself only carries a reference number inside its free-text summary. */
export type AuditAppInfo = {
  id: string;
  referenceNumber: string;
  applicationType: string;
  status: string;
  businessName: string;
};

const ACTION_LABEL: Record<string, string> = {
  application_submitted: "Application submitted",
  walkin_application_started: "Walk-in application filed",
  initial_review_approved: "Initial review approved",
  initial_review_returned: "Returned to applicant",
  department_decision: "Department decision",
  assessment_finalized: "Assessment finalized",
  payment_recorded: "Payment recorded",
  permit_printed: "Permit printed",
  permit_signed: "Permit signed",
  permit_released: "Permit released",
  staff_added: "Staff added",
  staff_activated: "Staff activated",
  staff_deactivated: "Staff deactivated",
  lgu_client_created: "Client onboarded",
  lgu_paused: "Client paused",
  lgu_resumed: "Client resumed",
};

// Same wording as businesses/page.tsx's own APP_STATUS_LABEL -- kept as a
// separate copy rather than a shared import since that map is a private,
// unexported const there (not worth a refactor just for this).
const APP_STATUS_LABEL: Record<string, string> = {
  submitted: "Submitted",
  pending_bplo_initial: "Pending BPLO review",
  pending_dept_review: "In department review",
  returned_to_applicant: "Returned to applicant",
  pending_bplo_assessment: "Pending assessment",
  pending_payment: "Pending payment",
  pending_printing: "Pending printing",
  pending_mayor: "Pending mayor's signature",
  pending_release: "Pending release",
  released: "Released",
  rejected: "Rejected",
};

function statusTone(status: string): "good" | "warn" | "bad" | "info" {
  if (status === "released") return "good";
  if (status === "returned_to_applicant" || status === "rejected") return "bad";
  if (status === "pending_bplo_initial" || status === "pending_bplo_assessment") return "warn";
  return "info";
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function exportCSV(filename: string, rows: AuditLogRow[], extraCols?: (r: AuditLogRow) => string[]) {
  const headers = ["Date/Time", "Actor", "Action", "Summary"];
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  for (const r of rows) {
    const cols = [formatDateTime(r.created_at), r.actor_label ?? "", ACTION_LABEL[r.action] ?? r.action, r.summary, ...(extraCols?.(r) ?? [])];
    lines.push(cols.map(esc).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

type AppGroup = {
  applicationId: string;
  referenceNumber: string;
  businessName: string;
  applicationType: string;
  status: string;
  events: AuditLogRow[]; // chronological, oldest first
  lastActivityAt: string;
};

/**
 * The audit trail's own explorer UI (CLAUDE.md 7o follow-up, redesigned
 * after feedback that a flat time-ordered feed didn't answer "which
 * business does this belong to, and what's this application's whole
 * story" -- see the doc comment on page.tsx for the full history).
 *
 * Two tabs:
 * - "By application" (default): every application with at least one
 *   logged event in the selected range, one row each, click to expand
 *   that application's own timeline in chronological order.
 * - "Other activity": events with no application_id at all (staff
 *   added/activated/deactivated, client onboarded/paused/resumed) --
 *   nothing to group those under, so they stay a flat list.
 *
 * Rows/apps arrive as props already fetched for the selected date range
 * (server-driven, via the date-range form below); search/action-type
 * filtering and the application/event grouping itself all happen
 * client-side against that fixed set, same pattern as Permit History's
 * own table (CLAUDE.md 7f).
 */
export function AuditTrailExplorer({
  rows, apps, from, to,
}: {
  rows: AuditLogRow[];
  apps: AuditAppInfo[];
  from: string;
  to: string;
}) {
  const [tab, setTab] = useState<"apps" | "other">("apps");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const appInfoById = useMemo(() => new Map(apps.map((a) => [a.id, a])), [apps]);

  const groups = useMemo(() => {
    const map = new Map<string, AppGroup>();
    for (const r of rows) {
      if (!r.application_id) continue;
      let g = map.get(r.application_id);
      if (!g) {
        const info = appInfoById.get(r.application_id);
        g = {
          applicationId: r.application_id,
          referenceNumber: info?.referenceNumber ?? "(reference unknown)",
          businessName: info?.businessName ?? "—",
          applicationType: info?.applicationType ?? "",
          status: info?.status ?? "",
          events: [],
          lastActivityAt: r.created_at,
        };
        map.set(r.application_id, g);
      }
      g.events.push(r);
      if (r.created_at > g.lastActivityAt) g.lastActivityAt = r.created_at;
    }
    for (const g of map.values()) g.events.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return [...map.values()].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }, [rows, appInfoById]);

  const otherRows = useMemo(
    () => rows.filter((r) => !r.application_id).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [rows]
  );

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => {
      if (g.referenceNumber.toLowerCase().includes(q) || g.businessName.toLowerCase().includes(q)) return true;
      return g.events.some((e) => e.summary.toLowerCase().includes(q) || (e.actor_label ?? "").toLowerCase().includes(q));
    });
  }, [groups, search]);

  const filteredOther = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return otherRows;
    return otherRows.filter((r) => r.summary.toLowerCase().includes(q) || (r.actor_label ?? "").toLowerCase().includes(q));
  }, [otherRows, search]);

  return (
    <div className="rounded-3xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(23,33,66,0.05),0_10px_28px_-12px_rgba(23,33,66,0.14)]">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <form className="flex flex-wrap items-end gap-2" method="get">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-ink-soft">From</span>
            <input type="date" name="from" defaultValue={from} className="h-8 rounded-lg border border-border-strong bg-surface px-2 text-[12.5px] text-ink" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-ink-soft">To</span>
            <input type="date" name="to" defaultValue={to} className="h-8 rounded-lg border border-border-strong bg-surface px-2 text-[12.5px] text-ink" />
          </label>
          <button type="submit" className="h-8 rounded-lg border border-border-strong px-3 text-[12px] font-bold text-ink-soft hover:text-ink">
            Apply
          </button>
        </form>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-ink-soft">Search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Reference no., business, staff name..."
            className="h-8 w-64 rounded-lg border border-border-strong bg-surface px-2 text-[12.5px] text-ink placeholder:text-ink-faint"
          />
        </label>

        <button
          type="button"
          onClick={() => exportCSV(`AuditTrail_${from}_to_${to}.csv`, rows, (r) => [appInfoById.get(r.application_id ?? "")?.referenceNumber ?? ""])}
          className="ml-auto h-8 rounded-lg bg-brand-navy px-3 text-[12px] font-bold text-white hover:opacity-90"
        >
          ↓ Export all as CSV
        </button>
      </div>

      <div className="mb-4 flex gap-2 border-b border-border" role="tablist" aria-label="Audit trail view">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "apps"}
          onClick={() => setTab("apps")}
          className={`-mb-px border-b-2 px-3 py-2 text-[12.5px] font-bold ${tab === "apps" ? "border-brand-teal text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
        >
          By application ({groups.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "other"}
          onClick={() => setTab("other")}
          className={`-mb-px border-b-2 px-3 py-2 text-[12.5px] font-bold ${tab === "other" ? "border-brand-teal text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
        >
          Other activity ({otherRows.length})
        </button>
      </div>

      {tab === "apps" ? (
        filteredGroups.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-soft">No application activity in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                  <th className="whitespace-nowrap py-2 pr-4">Reference no.</th>
                  <th className="py-2 pr-4">Business</th>
                  <th className="whitespace-nowrap py-2 pr-4">Type</th>
                  <th className="whitespace-nowrap py-2 pr-4">Status</th>
                  <th className="whitespace-nowrap py-2 pr-4">Last activity</th>
                  <th className="whitespace-nowrap py-2 pr-4">Events</th>
                  <th className="w-6 py-2" />
                </tr>
              </thead>
              <tbody>
                {filteredGroups.map((g) => {
                  const isOpen = expanded === g.applicationId;
                  return (
                    <Fragment key={g.applicationId}>
                      {/* role="button"/tabIndex/onKeyDown -- this row only responded to a
                          mouse click before (2026-08-20 audit finding), locking out anyone
                          navigating by keyboard from the primary interaction on this page. */}
                      <tr
                        onClick={() => setExpanded(isOpen ? null : g.applicationId)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setExpanded(isOpen ? null : g.applicationId);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Collapse" : "Expand"} history for ${g.referenceNumber}, ${g.businessName}`}
                        className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-teal focus-visible:-outline-offset-2"
                      >
                        <td className="whitespace-nowrap py-2.5 pr-4 font-bold text-ink">{g.referenceNumber}</td>
                        <td className="py-2.5 pr-4 text-ink">{g.businessName}</td>
                        <td className="whitespace-nowrap py-2.5 pr-4 text-ink-soft capitalize">{g.applicationType || "—"}</td>
                        <td className="whitespace-nowrap py-2.5 pr-4">
                          {g.status ? <TonePill label={APP_STATUS_LABEL[g.status] ?? g.status} tone={statusTone(g.status)} /> : "—"}
                        </td>
                        <td className="whitespace-nowrap py-2.5 pr-4 text-ink-soft">{formatDateTime(g.lastActivityAt)}</td>
                        <td className="whitespace-nowrap py-2.5 pr-4 text-ink-soft">{g.events.length}</td>
                        <td className="py-2.5 text-ink-faint">{isOpen ? "▾" : "▸"}</td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-border last:border-b-0">
                          <td colSpan={7} className="bg-surface-2 px-4 py-4">
                            {g.status && <WorkflowStepper status={g.status} />}
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                                Full history -- {g.referenceNumber}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  exportCSV(`${g.referenceNumber}_History.csv`, g.events);
                                }}
                                className="h-7 rounded-lg border border-border-strong px-2.5 text-[11.5px] font-bold text-ink-soft hover:text-ink"
                              >
                                ↓ Export this application
                              </button>
                            </div>
                            <ol className="space-y-3 border-l-2 border-border pl-4">
                              {g.events.map((e) => (
                                <li key={e.id} className="relative">
                                  <span className="absolute -left-[21px] top-1 size-2.5 rounded-full border-2 border-surface bg-brand-teal" />
                                  <div className="flex flex-wrap items-baseline gap-x-2">
                                    <span className="text-[12px] font-bold text-ink">{ACTION_LABEL[e.action] ?? e.action}</span>
                                    <span className="text-[11px] text-ink-faint">{formatDateTime(e.created_at)}</span>
                                  </div>
                                  <p className="text-[12.5px] text-ink-soft">{e.summary}</p>
                                  {e.actor_label && <p className="text-[11.5px] text-ink-faint">by {e.actor_label}</p>}
                                  {e.details && typeof e.details === "object" && "notes" in e.details && e.details.notes ? (
                                    <p className="text-[11.5px] italic text-ink-faint">&ldquo;{String(e.details.notes)}&rdquo;</p>
                                  ) : null}
                                </li>
                              ))}
                            </ol>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : filteredOther.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-ink-soft">No staff/account activity in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                <th className="whitespace-nowrap py-2 pr-4">Date/Time</th>
                <th className="whitespace-nowrap py-2 pr-4">Actor</th>
                <th className="whitespace-nowrap py-2 pr-4">Action</th>
                <th className="py-2">Summary</th>
              </tr>
            </thead>
            <tbody>
              {filteredOther.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-b-0">
                  <td className="whitespace-nowrap py-2 pr-4 text-ink-soft">{formatDateTime(r.created_at)}</td>
                  <td className="whitespace-nowrap py-2 pr-4 text-ink">{r.actor_label ?? "—"}</td>
                  <td className="whitespace-nowrap py-2 pr-4 text-ink-soft">{ACTION_LABEL[r.action] ?? r.action}</td>
                  <td className="py-2 text-ink">{r.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
