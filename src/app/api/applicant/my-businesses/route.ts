import { getApplicantOwnerId } from "@/lib/applicant-session";
import { BUSINESS_PROFILE_COLUMNS, mapBusinessProfile } from "@/lib/business-profile";
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
    .select(BUSINESS_PROFILE_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("is_active", true);

  if (error) {
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  // BUSINESS_PROFILE_COLUMNS is a runtime string, not a literal template, so
  // supabase-js can't infer a real row type here -- cast once at the boundary.
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return NextResponse.json({
    businesses: rows.map(mapBusinessProfile),
  });
}
