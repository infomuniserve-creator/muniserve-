import { getPilotLguId } from "@/lib/lgu";
import { maskName } from "@/lib/mask";
import { BUSINESS_PROFILE_COLUMNS, mapBusinessProfile } from "@/lib/business-profile";
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

  // BUSINESS_PROFILE_COLUMNS is a runtime string, not a literal template, so
  // supabase-js can't infer a real row type here -- cast once at the
  // boundary rather than fighting it field by field.
  const { data } = await supabase
    .from("businesses")
    .select(BUSINESS_PROFILE_COLUMNS)
    .eq("lgu_id", lguId)
    .eq("legacy_license_no", licenseNumber)
    .eq("is_legacy_unclaimed", true)
    .maybeSingle();
  const business = data as unknown as (Record<string, unknown> & { legacy_owner_name: string | null }) | null;

  if (!business) {
    return NextResponse.json({ found: false });
  }

  return NextResponse.json({
    found: true,
    business: {
      ...mapBusinessProfile(business),
      ownerNameMasked: business.legacy_owner_name ? maskName(business.legacy_owner_name) : "Unknown",
    },
  });
}
