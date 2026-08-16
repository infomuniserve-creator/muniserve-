import { resolveLguId } from "@/lib/lgu";
import { maskName, maskPhone } from "@/lib/mask";
import { BUSINESS_PROFILE_COLUMNS, mapBusinessProfile } from "@/lib/business-profile";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

type BusinessRow = Record<string, unknown> & {
  id: string;
  owner_id: string | null;
  legacy_owner_name: string | null;
  owner: { phone: string | null } | null;
};

/**
 * Renewal lookup by Permit Number (2026-08-16 follow-up, renamed from
 * License Number lookup -- CLAUDE.md section 5, step 1-2). A business
 * registered fresh through MuniServe never gets a "License Number" at
 * all (that only ever existed for legacy paper-imported records) --
 * "Permit Number" is what's actually printed on the certificate every
 * business gets (`applications.reference_number`, permit-pdf.ts/
 * print-certificate.ts's own "Permit No." field), so this now searches
 * BOTH: `businesses.legacy_license_no` (an older paper permit) and
 * `applications.reference_number` (any of a business's own past permit
 * numbers -- any one of them resolves to the same business).
 *
 * Previously this only ever matched a still-unclaimed legacy business,
 * on purpose -- an already-claimed business isn't self-service-
 * reclaimable through a bare number lookup, since License Number alone
 * is only a safe-enough bar for the very FIRST claim (nobody owns it
 * yet); letting a number alone re-link an already-claimed business to a
 * new phone would let anyone who's ever seen that number (printed on a
 * permit or receipt) hijack someone else's account.
 *
 * The real fix, now that it exists: an already-claimed match still
 * requires proving control of the REAL phone already on file -- OTP is
 * sent there (send-renewal-otp/route.ts), server-side, never to a number
 * the client supplies. This route only ever hands the client a MASKED
 * hint of that number, never the real one, so a lookup alone can't leak
 * a real owner's phone to a stranger who just knows/guesses a Permit
 * Number. `claimed: true` replaces the old `alreadyClaimed` dead-end
 * response entirely -- what used to be "go ask BPLO" is now something
 * this flow can resolve itself, when the applicant still has that phone.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const permitNumber = String(body?.permitNumber ?? "").trim();
  if (!permitNumber) {
    return NextResponse.json({ found: false });
  }

  const supabase = createServiceClient();
  // Resolved from the request's Host header (CLAUDE.md 7o) -- a new
  // client's own businesses/applications live under their own lgu_id,
  // not San Miguel's, so a lookup from their subdomain must search theirs.
  const lguId = await resolveLguId(request.headers.get("host"));

  const businessColumns = `${BUSINESS_PROFILE_COLUMNS}, owner_id, owner:owners(phone)`;

  const { data: legacyMatch } = await supabase
    .from("businesses")
    .select(businessColumns)
    .eq("lgu_id", lguId)
    .eq("legacy_license_no", permitNumber)
    .maybeSingle();

  let business = legacyMatch as unknown as BusinessRow | null;

  if (!business) {
    const { data: appMatch } = await supabase
      .from("applications")
      .select(`business:businesses(${businessColumns})`)
      .eq("lgu_id", lguId)
      .eq("reference_number", permitNumber)
      .maybeSingle();
    business = (appMatch?.business as unknown as BusinessRow | null) ?? null;
  }

  if (!business) {
    return NextResponse.json({ found: false });
  }

  if (business.owner_id && business.owner?.phone) {
    return NextResponse.json({
      found: true,
      claimed: true,
      business: {
        ...mapBusinessProfile(business),
        maskedPhone: maskPhone(business.owner.phone),
      },
    });
  }

  return NextResponse.json({
    found: true,
    claimed: false,
    business: {
      ...mapBusinessProfile(business),
      ownerNameMasked: business.legacy_owner_name ? maskName(business.legacy_owner_name) : "Unknown",
    },
  });
}
