import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { generateOrderOfPaymentPdf, type OrderOfPaymentInput } from "@/lib/order-of-payment-pdf";
import { createClient } from "@/lib/supabase/server";

/**
 * Serves the Order of Payment slip (CLAUDE.md, order-of-payment-pdf.ts's
 * own doc comment) -- opens inline so BPLO/Treasury can print it straight
 * from the browser, same convention as print-permit's route. Any staff
 * role at the application's own LGU can view it (Treasury needs this too,
 * to confirm what's being paid -- not BPLO-only), same audience as
 * application-form-pdf's route.
 *
 * Reads from `application_fee_lines` (written at finalize time), never
 * re-running computeApplicationFees() -- see order-of-payment-pdf.ts's own
 * comment on why this needs to stay reprint-accurate.
 */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff) {
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
      `reference_number, application_type, mode_of_payment, assessment_finalized_at, assessment_finalized_by, lgu_id,
       business:businesses(business_name, trade_name, unit_street, city_town, barangay, province, zip_code, address, owner:owners(full_name))`
    )
    .eq("id", applicationId)
    .eq("lgu_id", staff.lgu_id)
    .single();
  if (error || !application) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }
  if (!application.assessment_finalized_at) {
    return NextResponse.json({ error: "This application hasn't been assessed yet" }, { status: 400 });
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

  const { data: feeLines } = await supabase
    .from("application_fee_lines")
    .select("acct_code, display_label, computed_amount, overridden_amount, included_in_total")
    .eq("application_id", applicationId)
    .eq("included_in_total", true)
    .order("created_at", { ascending: true });

  const lines = (feeLines ?? []).map((l) => ({
    acctCode: l.acct_code,
    displayLabel: l.display_label ?? "",
    amount: l.overridden_amount ?? l.computed_amount,
  }));
  const totalDue = lines.reduce((sum, l) => sum + Number(l.amount), 0);

  let assessedByName: string | null = null;
  if (application.assessment_finalized_by) {
    const { data: assessor } = await supabase.from("staff_users").select("full_name").eq("id", application.assessment_finalized_by).maybeSingle();
    assessedByName = assessor?.full_name ?? null;
  }

  const lgu = await getLguDisplay(supabase, application.lgu_id);

  const structuredAddress = [business?.unit_street, business?.city_town, business?.barangay, business?.province, business?.zip_code]
    .filter(Boolean)
    .join(", ");
  const address = structuredAddress || business?.address || "";

  const input: OrderOfPaymentInput = {
    referenceNumber: application.reference_number,
    applicationType: application.application_type as "new" | "renewal",
    businessName: business?.trade_name || business?.business_name || "(business record missing)",
    ownerName: business?.owner?.full_name ?? "—",
    address,
    modeOfPayment: application.mode_of_payment,
    assessedByName,
    assessedOn: new Date(application.assessment_finalized_at),
    lines,
    totalDue,
    lgu,
  };

  const pdf = await generateOrderOfPaymentPdf(input);

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${application.reference_number}-order-of-payment.pdf"`,
    },
  });
}
