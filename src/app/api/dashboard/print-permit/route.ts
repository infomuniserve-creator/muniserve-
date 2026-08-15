import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { generatePrePrintCertificate } from "@/lib/print-certificate";
import { createClient } from "@/lib/supabase/server";

/**
 * Serves the pre-signature print-ready certificate for an application at
 * "For Printing" (CLAUDE.md 7x) -- opens inline (Content-Disposition:
 * inline, not attachment) so clicking it from bplo/page.tsx's queue opens
 * the PDF directly in a new tab, ready for the browser's own print
 * dialog, rather than downloading a file first.
 *
 * BPLO-only, same gating as markPrinted/the rest of that queue -- a
 * route handler rather than a server action since a PDF response needs
 * real headers (Content-Type/Content-Disposition), which a server
 * action's plain-JS-value return can't produce.
 */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const applicationId = request.nextUrl.searchParams.get("applicationId");
  if (!applicationId) {
    return NextResponse.json({ error: "applicationId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: application, error } = await supabase
    .from("applications")
    .select(
      `reference_number, application_type, application_year, lgu_id,
       business:businesses(business_name, trade_name, unit_street, city_town, barangay, province, zip_code, address, owner:owners(full_name))`
    )
    .eq("id", applicationId)
    .eq("lgu_id", staff.lgu_id)
    .single();
  if (error || !application) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  const business = application.business as unknown as {
    business_name: string;
    trade_name: string | null;
    unit_street: string | null;
    city_town: string | null;
    barangay: string | null;
    province: string | null;
    zip_code: string | null;
    address: string | null;
    owner: { full_name: string } | null;
  } | null;

  const { data: payments } = await supabase
    .from("payments")
    .select("or_number, amount, received_at")
    .eq("application_id", applicationId)
    .order("received_at", { ascending: false });
  const amountPaid = (payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
  const latestPayment = payments?.[0] ?? null;

  const lgu = await getLguDisplay(supabase, application.lgu_id);

  const structuredAddress = [business?.unit_street, business?.city_town, business?.barangay, business?.province, business?.zip_code]
    .filter(Boolean)
    .join(", ");
  const address = structuredAddress || business?.address || "";

  const pdf = await generatePrePrintCertificate({
    referenceNumber: application.reference_number,
    applicationType: application.application_type as "new" | "renewal",
    businessName: business?.trade_name || business?.business_name || "(business record missing)",
    ownerName: business?.owner?.full_name ?? "—",
    address,
    receiptNo: latestPayment?.or_number ?? null,
    amountPaid: (payments?.length ?? 0) > 0 ? amountPaid : null,
    issuedOn: latestPayment?.received_at ? new Date(latestPayment.received_at) : new Date(),
    applicationYear: application.application_year,
    lgu,
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${application.reference_number}-for-printing.pdf"`,
    },
  });
}
