import { resolveLguId } from "@/lib/lgu";
import { maskName, maskPhone } from "@/lib/mask";
import { BUSINESS_PROFILE_COLUMNS, mapBusinessProfile } from "@/lib/business-profile";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

/**
 * Renewal legacy-claim lookup (CLAUDE.md section 5, step 1-2). Only
 * matches businesses still `is_legacy_unclaimed` -- an already-claimed
 * business isn't re-claimable through this path, on purpose: License
 * Number alone is only a safe-enough bar for the very FIRST claim (nobody
 * owns it yet); letting it re-link an already-claimed business to a
 * different phone would let anyone who's ever seen that number (printed
 * on a permit or receipt) hijack someone else's account.
 *
 * 2026-08-16 follow-up: an already-claimed business used to just report
 * `found: false`, identical to "no business with that number exists at
 * all" -- a real dead end for a returning owner who's lost access to
 * their old registered phone (a genuinely common case over multi-year
 * renewal cycles) and has no way to know their business is really on
 * file. Now distinguishes that case (`alreadyClaimed: true`, plus a
 * masked hint of the phone it's under) so the client can point them at
 * the actual fix -- BPLO updating the phone on file after verifying their
 * identity in person, see businesses/actions.ts's `updateOwnerPhone`.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const licenseNumber = String(body?.licenseNumber ?? "").trim();
  if (!licenseNumber) {
    return NextResponse.json({ found: false });
  }

  const supabase = createServiceClient();
  // Resolved from the request's Host header (CLAUDE.md 7o) -- a new
  // client's legacy business roster lives under their own lgu_id, not
  // San Miguel's, so a license lookup from their subdomain must search
  // the right one.
  const lguId = await resolveLguId(request.headers.get("host"));

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

  if (business) {
    return NextResponse.json({
      found: true,
      business: {
        ...mapBusinessProfile(business),
        ownerNameMasked: business.legacy_owner_name ? maskName(business.legacy_owner_name) : "Unknown",
      },
    });
  }

  const { data: claimedRow } = await supabase
    .from("businesses")
    .select("owner:owners(phone)")
    .eq("lgu_id", lguId)
    .eq("legacy_license_no", licenseNumber)
    .eq("is_legacy_unclaimed", false)
    .maybeSingle();
  const claimedOwner = claimedRow?.owner as unknown as { phone: string | null } | null;

  if (claimedRow) {
    return NextResponse.json({
      found: false,
      alreadyClaimed: true,
      maskedPhone: claimedOwner?.phone ? maskPhone(claimedOwner.phone) : null,
    });
  }

  return NextResponse.json({ found: false });
}
