"use client";

import { useMemo, useState } from "react";

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

/**
 * Client-side search/filter/CSV-export table, same pattern as Permit
 * History's own table (CLAUDE.md 7f) -- receives every row already
 * fetched for the selected date range as props, filters in the browser
 * rather than re-querying per keystroke. Date-range widening itself is a
 * plain GET form (server-driven navigation, no client state needed for
 * that part) since it has to re-fetch from the database, unlike search/
 * action-type which only narrow what's already loaded.
 */
export function AuditTrailTable({ rows, from, to }: { rows: AuditLogRow[]; from: string; to: string }) {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const availableActions = useMemo(() => {
    const seen = new Set(rows.map((r) => r.action));
    return [...seen].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (actionFilter && r.action !== actionFilter) return false;
      if (!q) return true;
      return r.summary.toLowerCase().includes(q) || (r.actor_label ?? "").toLowerCase().includes(q);
    });
  }, [rows, search, actionFilter]);

  function exportCSV() {
    const headers = ["Date/Time", "Actor", "Action", "Summary"];
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = [headers.join(",")];
    for (const r of filtered) {
      lines.push([esc(formatDateTime(r.created_at)), esc(r.actor_label ?? ""), esc(ACTION_LABEL[r.action] ?? r.action), esc(r.summary)].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `MuniServe_AuditTrail_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

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

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold text-ink-soft">Action type</span>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="h-8 rounded-lg border border-border-strong bg-surface px-2 text-[12.5px] text-ink"
          >
            <option value="">All actions</option>
            {availableActions.map((a) => (
              <option key={a} value={a}>{ACTION_LABEL[a] ?? a}</option>
            ))}
          </select>
        </label>

        <span className="text-[12px] text-ink-soft">{filtered.length} of {rows.length} events</span>

        <button type="button" onClick={exportCSV} className="ml-auto h-8 rounded-lg bg-brand-navy px-3 text-[12px] font-bold text-white hover:opacity-90">
          ↓ Export CSV
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-ink-soft">No activity in this range.</p>
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
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-b-0">
                  <td className="whitespace-nowrap py-2 pr-4 text-ink-soft">{formatDateTime(r.created_at)}</td>
                  <td className="whitespace-nowrap py-2 pr-4 text-ink">{r.actor_label ?? "—"}</td>
                  <td className="whitespace-nowrap py-2 pr-4 text-ink-soft">{ACTION_LABEL[r.action] ?? r.action}</td>
                  <td className="py-2 text-ink">
                    {r.summary}
                    {r.details && typeof r.details === "object" && "notes" in r.details && r.details.notes ? (
                      <span className="block text-[11.5px] italic text-ink-faint">&ldquo;{String(r.details.notes)}&rdquo;</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
