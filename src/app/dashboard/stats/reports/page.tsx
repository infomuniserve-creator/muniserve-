import { getCurrentStaff } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { computeRevenueReport, type RevenueBucketKey } from "@/lib/revenue-report";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card, EmptyState, SectionHead, StatCard, StatGrid } from "../../ui";
import { StatsSubNav } from "../sub-nav";
import { DownloadCsvButton } from "./export-buttons";

/**
 * Revenue breakdown -- the "Reports" half of Stats & Reports (2026-08-17,
 * project owner's request). Same gating and date-range shape as
 * Performance (BPLO + Mayor, 90-day default, from/to date pickers) --
 * all the real computation lives in src/lib/revenue-report.ts, which also
 * documents the basis (collected, not assessed) and the "Engineering
 * isn't its own fee_category" nuance in detail.
 */
export default async function RevenueReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "bplo" && staff.role !== "mayor") redirect("/dashboard");

  const supabase = await createClient();
  const lgu = await getLguDisplay(supabase, staff.lgu_id);

  const params = await searchParams;
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 90);
  const from = params.from || defaultFrom.toISOString().slice(0, 10);
  const to = params.to || now.toISOString().slice(0, 10);

  const report = await computeRevenueReport(supabase, staff.lgu_id, { from, to });

  const bucketByKey = new Map(report.buckets.map((b) => [b.key, b]));
  const linesByBucket = (key: RevenueBucketKey) => report.lines.filter((l) => l.bucket === key);
  const fmt = (n: number) => `Php ${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const rangeSuffix = `${from}_to_${to}`;

  return (
    <>
      <StatsSubNav active="reports" />
      <SectionHead
        title="Reports"
        sub="Revenue actually collected, broken down by fee category. Only counts applications with a recorded payment in this range."
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
        <span className="text-[12px] text-ink-soft">{report.paidApplicationCount} application(s) paid in this range.</span>
        <DownloadCsvButton lines={report.lines} filenamePrefix={`MuniServe_RevenueReport_${rangeSuffix}`} label="Download all as CSV" variant="solid" />
      </Card>

      {!lgu.cedulaIncludedOnline && (
        <div className="mb-6 rounded-2xl bg-info-bg px-5 py-3.5">
          <p className="text-[12.5px] font-bold text-info-ink">
            ℹ CEDULA is currently set to counter-paid for {lgu.name} (see Settings) -- the CEDULA figure below only reflects what&rsquo;s collected online through
            MuniServe, which will read low or zero even though CEDULA is still genuinely being collected, just not through this system.
          </p>
        </div>
      )}

      {report.paidApplicationCount === 0 ? (
        <EmptyState>No payments recorded in this date range.</EmptyState>
      ) : (
        <>
          <div className="mb-9">
            <StatGrid>
              <StatCard label="Total collected" value={fmt(report.grandTotal)} tone="good" />
              <StatCard label="Barangay Clearance" value={fmt(bucketByKey.get("barangay_clearance")?.total ?? 0)} tone="info" />
              <StatCard label="Engineering" value={fmt(bucketByKey.get("engineering")?.total ?? 0)} tone="info" />
              <StatCard label="CEDULA" value={fmt(bucketByKey.get("cedula")?.total ?? 0)} tone="info" />
              <StatCard label="Actual Permit" value={fmt(bucketByKey.get("actual_permit")?.total ?? 0)} tone="warn" />
            </StatGrid>
          </div>

          <div className="mb-9">
            <SectionHead title="Actual Permit -- what's inside it" sub="Local Business Tax + Mayor's Permit Fee + every other regulatory fee, net of the essential-commodity discount." />
            <Card className="p-5">
              <div className="flex flex-col gap-2.5">
                {report.actualPermitBreakdown.map((b) => (
                  <div key={b.label} className="flex items-center justify-between">
                    <span className="text-[12.5px] font-bold text-ink-soft">{b.label}</span>
                    <span className="text-[13px] font-bold text-ink tabular-nums">{fmt(b.total)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {(["barangay_clearance", "engineering", "cedula", "actual_permit"] as RevenueBucketKey[]).map((key) => {
            const bucket = bucketByKey.get(key);
            const bucketLines = linesByBucket(key);
            return (
              <div key={key} className="mb-9">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <SectionHead title={bucket?.label ?? key} sub={`${bucket?.applicationCount ?? 0} application(s) · ${fmt(bucket?.total ?? 0)}`} />
                  <DownloadCsvButton lines={bucketLines} filenamePrefix={`MuniServe_${bucket?.label.replace(/\s+/g, "")}_${rangeSuffix}`} label="Download CSV" />
                </div>
                {bucketLines.length === 0 ? (
                  <EmptyState>Nothing collected in this category for this range.</EmptyState>
                ) : (
                  <Card>
                    {bucketLines.map((l, i) => (
                      <div key={`${l.applicationId}-${l.displayLabel}-${i}`} className="flex items-center gap-3 border-b border-border px-4.5 py-3 last:border-b-0">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-bold text-ink">{l.businessName}</p>
                          <p className="text-[11.5px] text-ink-soft">
                            {l.referenceNumber} · {l.displayLabel}
                            {l.acctCode ? ` · Acct ${l.acctCode}` : ""} ·{" "}
                            {new Date(l.paidAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric" })}
                          </p>
                        </div>
                        <span className="shrink-0 text-[13px] font-bold text-ink tabular-nums">{fmt(l.amount)}</span>
                      </div>
                    ))}
                  </Card>
                )}
              </div>
            );
          })}
        </>
      )}
    </>
  );
}
