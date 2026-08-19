import { NextResponse } from "next/server";
import { requireUnpausedStaff } from "@/lib/staff";
import { buildBusinessImportTemplateCsv } from "@/lib/business-import";

/**
 * Always the example template, not a round-trip of an LGU's existing
 * businesses -- unlike the fee-rule template (which re-exports current
 * rates as an editable starting point, since those get revised yearly),
 * this import is a one-time-ish onboarding action, and a real roster
 * could be 1,000+ rows -- nothing to usefully "download and re-edit"
 * here, just the column format. BPLO-gated, same as every other
 * Settings download route -- a route handler rather than a server
 * action since a file download needs a real Content-Disposition header.
 */
export async function GET() {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const csv = buildBusinessImportTemplateCsv();
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="business-roster-template.csv"`,
    },
  });
}
