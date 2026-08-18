import { getCurrentStaff } from "@/lib/staff";
import { computePerformanceStats } from "@/lib/performance-stats";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card, EmptyState, SectionHead, StatCard, StatGrid, TonePill } from "../ui";
import { StatsSubNav } from "./sub-nav";

/**
 * Processing-speed and bottleneck report (CLAUDE.md 7o follow-up) -- the
 * project owner asked directly for "the speed of that municipality in
 * terms of handling business applications... where mostly the department
 * that takes time approving, or where the bottleneck is happening."
 * BPLO and Mayor only, same reasoning and same nav gating as Audit Trail.
 *
 * All computation lives in src/lib/performance-stats.ts, kept separate
 * from this page's rendering -- the module's own comments document
 * exactly which stage durations are exact vs. best-effort approximations
 * given what's actually captured on `applications`.
 *
 * No chart library -- simple CSS width-scaled horizontal bars, matching
 * this app's existing "hand-authored, no external dependency" approach
 * to icons (src/app/dashboard/ui.tsx) rather than pulling in recharts/
 * chart.js for a handful of comparative bars.
 */
export default async function PerformanceStatsPage({
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

  const stats = await computePerformanceStats(supabase, staff.lgu_id, { from, to });

  const maxStageDays = Math.max(1, ...stats.stageAverages.map((s) => s.avgDays ?? 0));
  const maxDeptDays = Math.max(1, ...stats.departmentTurnaround.map((d) => d.avgDays ?? 0));
  const slowestDept = stats.departmentTurnaround.find((d) => d.avgDays != null);

  function fmtDays(d: number | null): string {
    if (d == null) return "—";
    return d < 1 ? `${Math.round(d * 24)} hrs` : `${d.toFixed(1)} days`;
  }

  return (
    <>
      <StatsSubNav active="performance" />
      <SectionHead
        title="Performance"
        sub="How fast applications actually move through the pipeline, and where they get stuck."
      />

      <Card className="mb-6 flex flex-wrap items-end gap-3 p-4">
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
        <span className="text-[12px] text-ink-soft">Based on {stats.totalApplications} application(s) submitted in this range.</span>
      </Card>

      {stats.totalApplications === 0 ? (
        <EmptyState>No applications submitted in this date range.</EmptyState>
      ) : (
        <>
          <div className="mb-9">
            <StatGrid>
              <StatCard label="Applications submitted" value={stats.totalApplications} tone="neutral" />
              <StatCard label="Released" value={stats.releasedCount} tone="good" />
              <StatCard label="Avg. days to release" value={fmtDays(stats.avgDaysSubmittedToReleased)} tone="info" />
              <StatCard label="Median days to release" value={fmtDays(stats.medianDaysSubmittedToReleased)} tone="info" />
              <StatCard label="New (avg. days)" value={fmtDays(stats.byType.new.avgDays)} tone="neutral" />
              <StatCard label="Renewal (avg. days)" value={fmtDays(stats.byType.renewal.avgDays)} tone="neutral" />
            </StatGrid>
          </div>

          {slowestDept && (
            <div className="mb-6 rounded-2xl bg-warn-bg px-5 py-3.5">
              <p className="text-[13px] font-bold text-warn-ink">
                ⚠ Current bottleneck: <strong>{slowestDept.department}</strong> averages {fmtDays(slowestDept.avgDays)} to decide
                {slowestDept.pendingCount > 0 ? ` (${slowestDept.pendingCount} still pending right now)` : ""}.
              </p>
            </div>
          )}

          <div className="mb-9">
            <SectionHead title="Time spent per stage" sub="Average days from one checkpoint to the next, across all applications with both timestamps in this range." />
            <Card className="p-5">
              <div className="flex flex-col gap-3">
                {stats.stageAverages.map((s) => (
                  <div key={s.stage} className="flex items-center gap-3">
                    <span className="w-44 shrink-0 text-[12.5px] font-bold text-ink-soft">{s.stage}</span>
                    <div className="h-5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-brand-navy to-brand-teal"
                        style={{ width: s.avgDays != null ? `${Math.max(2, (s.avgDays / maxStageDays) * 100)}%` : "0%" }}
                      />
                    </div>
                    <span className="w-24 shrink-0 text-right text-[12.5px] text-ink">{fmtDays(s.avgDays)}</span>
                    <span className="w-16 shrink-0 text-right text-[11px] text-ink-faint">n={s.sampleSize}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="mb-9">
            <SectionHead title="Department turnaround" sub="Average time from when a department is assigned to when it decides -- sorted slowest first." />
            {stats.departmentTurnaround.length === 0 ? (
              <EmptyState>No department decisions recorded in this range.</EmptyState>
            ) : (
              <Card className="p-5">
                <div className="flex flex-col gap-3">
                  {stats.departmentTurnaround.map((d, i) => (
                    <div key={d.department} className="flex items-center gap-3">
                      <span className="w-44 shrink-0 text-[12.5px] font-bold text-ink-soft">
                        {i === 0 && d.avgDays != null && "🐢 "}
                        {d.department}
                      </span>
                      <div className="h-5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className={`h-full rounded-full ${i === 0 && d.avgDays != null ? "bg-warn" : "bg-info"}`}
                          style={{ width: d.avgDays != null ? `${Math.max(2, (d.avgDays / maxDeptDays) * 100)}%` : "0%" }}
                        />
                      </div>
                      <span className="w-24 shrink-0 text-right text-[12.5px] text-ink">{fmtDays(d.avgDays)}</span>
                      <span className="w-16 shrink-0 text-right text-[11px] text-ink-faint">n={d.sampleSize}</span>
                      {d.pendingCount > 0 && <TonePill label={`${d.pendingCount} pending`} tone="warn" />}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>

          <div>
            <SectionHead title="Currently stuck" sub="Applications still open, ranked by how long they've been sitting at their current stage." />
            {stats.stuckApplications.length === 0 ? (
              <EmptyState>Nothing currently open in this range -- everything has moved to released or was returned.</EmptyState>
            ) : (
              <Card>
                {stats.stuckApplications.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 border-b border-border px-4.5 py-3 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-bold text-ink">{a.businessName}</p>
                      <p className="text-[12px] text-ink-soft">{a.referenceNumber} · {a.status}</p>
                    </div>
                    <TonePill label={fmtDays(a.daysStuck)} tone={a.daysStuck > 7 ? "bad" : a.daysStuck > 3 ? "warn" : "neutral"} />
                  </div>
                ))}
              </Card>
            )}
          </div>
        </>
      )}
    </>
  );
}
