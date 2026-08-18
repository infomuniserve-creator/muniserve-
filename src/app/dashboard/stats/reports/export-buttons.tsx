"use client";

import type { RevenueBucketKey, RevenueLine } from "@/lib/revenue-report";

/** Same client-side CSV generation this app already established (audit-trail-table.tsx's own exportCSV) -- a Blob + object URL, no server route. */
function exportCSV(filename: string, lines: RevenueLine[], bucketLabel: (key: RevenueBucketKey) => string) {
  const headers = ["Date Paid", "Reference No.", "Business", "Category", "Fee Line", "Acct Code", "Amount"];
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [headers.join(",")];
  for (const l of lines) {
    const cols = [
      new Date(l.paidAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric" }),
      l.referenceNumber,
      l.businessName,
      bucketLabel(l.bucket),
      l.displayLabel,
      l.acctCode ?? "",
      l.amount.toFixed(2),
    ];
    rows.push(cols.map(esc).join(","));
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const BUCKET_LABEL: Record<RevenueBucketKey, string> = {
  barangay_clearance: "Barangay Clearance",
  engineering: "Engineering",
  cedula: "CEDULA",
  actual_permit: "Actual Permit",
};

export function DownloadCsvButton({
  lines,
  filenamePrefix,
  label = "Download CSV",
  variant = "outline",
}: {
  lines: RevenueLine[];
  filenamePrefix: string;
  label?: string;
  variant?: "outline" | "solid";
}) {
  const className =
    variant === "solid"
      ? "h-8 rounded-lg bg-brand-navy px-3 text-[12px] font-bold text-white hover:opacity-90"
      : "h-8 rounded-lg border border-border-strong px-3 text-[12px] font-bold text-ink-soft hover:text-ink";
  return (
    <button
      type="button"
      onClick={() => exportCSV(`${filenamePrefix}.csv`, lines, (key) => BUCKET_LABEL[key])}
      disabled={lines.length === 0}
      className={`${className} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      ↓ {label}
    </button>
  );
}
