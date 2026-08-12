import { getApplicantOwnerId } from "@/lib/applicant-session";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

/**
 * Lists the authenticated owner's businesses -- used for a returning
 * owner's second-and-later renewal (CLAUDE.md section 5: "every renewal
 * after this first one works purely on phone-number OTP, no License
 * Number needed") to pick which business they're renewing, and for the
 * new-business owner-match screen's "N businesses currently on file" copy.
 */
export async function GET() {
  const ownerId = await getApplicantOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("businesses")
    .select("id, business_name, barangay, nature_of_business, gross_sales_history")
    .eq("owner_id", ownerId)
    .eq("is_active", true);

  if (error) {
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  return NextResponse.json({
    businesses: (data ?? []).map((b) => {
      const history = (b.gross_sales_history as Record<string, number> | null) ?? {};
      const latestYear = Object.keys(history).sort().at(-1);
      return {
        id: b.id,
        businessName: b.business_name,
        barangay: b.barangay,
        natureOfBusiness: b.nature_of_business,
        grossSales: latestYear ? history[latestYear] : null,
      };
    }),
  });
}
