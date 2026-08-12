import { getPilotLguId } from "@/lib/lgu";
import { maskName } from "@/lib/mask";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

/**
 * Renewal legacy-claim lookup (CLAUDE.md section 5, step 1-2). Only
 * matches businesses still `is_legacy_unclaimed` -- an already-claimed
 * business shouldn't be re-claimable through this path; someone hitting
 * that case should sign in with their phone instead (rule #2: renewal
 * never creates a new owner, it resolves to the existing businesses row,
 * which by definition is already linked to an owner at that point).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const licenseNumber = String(body?.licenseNumber ?? "").trim();
  if (!licenseNumber) {
    return NextResponse.json({ found: false });
  }

  const supabase = createServiceClient();
  const lguId = await getPilotLguId();

  const { data: business } = await supabase
    .from("businesses")
    .select("id, business_name, legacy_owner_name, barangay, nature_of_business, lbt_category, gross_sales_history")
    .eq("lgu_id", lguId)
    .eq("legacy_license_no", licenseNumber)
    .eq("is_legacy_unclaimed", true)
    .maybeSingle();

  if (!business) {
    return NextResponse.json({ found: false });
  }

  const salesHistory = (business.gross_sales_history as Record<string, number> | null) ?? {};
  const latestYear = Object.keys(salesHistory).sort().at(-1);
  const grossSales = latestYear ? salesHistory[latestYear] : null;

  return NextResponse.json({
    found: true,
    business: {
      id: business.id,
      businessName: business.business_name,
      ownerNameMasked: business.legacy_owner_name ? maskName(business.legacy_owner_name) : "Unknown",
      barangay: business.barangay,
      natureOfBusiness: business.nature_of_business,
      lbtCategory: business.lbt_category,
      grossSales,
    },
  });
}
