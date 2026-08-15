import { NextRequest, NextResponse } from "next/server";
import { getExportableFeeRules } from "@/app/dashboard/settings/actions";
import { buildLbtTemplateCsv, buildMayorsPermitTemplateCsv, type FeeType } from "@/lib/fee-rule-import";

/**
 * Downloads the current live LBT or Mayor's Permit fee rules as a CSV,
 * shaped exactly like the file the upload flow expects back (Settings'
 * "Business Tax & Mayor's Permit Fee Setup"). Round-trips naturally: a
 * brand-new LGU with no rules yet gets a labeled example to replace, an
 * LGU that already has rates gets *those* rates back as an editable
 * starting point instead of a blank template -- both "set this up for the
 * first time" and "change a couple of numbers next year" are the same
 * download-edit-upload flow.
 *
 * A route handler rather than a server action because a file download
 * needs a real Content-Disposition response, which a server action (whose
 * return value is a JS value, not an HTTP response) can't produce.
 */
export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type");
  if (type !== "lbt" && type !== "mayors_permit") {
    return NextResponse.json({ error: "type must be 'lbt' or 'mayors_permit'" }, { status: 400 });
  }
  const feeType = type as FeeType;

  let exported;
  try {
    exported = await getExportableFeeRules(feeType);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: message === "Not authorized" ? 403 : 500 });
  }

  const csv = "lbt" in exported ? buildLbtTemplateCsv(exported.lbt) : buildMayorsPermitTemplateCsv(exported.mp);
  const filename = feeType === "lbt" ? "local-business-tax.csv" : "mayors-permit-fee.csv";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
