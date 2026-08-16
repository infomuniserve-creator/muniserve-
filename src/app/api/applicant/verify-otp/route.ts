import { applicantSessionCookieOptions, createApplicantSession } from "@/lib/applicant-session";
import { normalizePhone } from "@/lib/phone";
import { verifyOtp } from "@/lib/otp";
import { createServiceClient } from "@/lib/supabase/service";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Verifies the OTP, then resolves identity per CLAUDE.md section 5 and
 * rule #3: if the phone matches an existing owners row, that's who they
 * are (dedupe on phone, not per-business) -- no confirmation gate beyond
 * the OTP itself, since receiving the SMS already proves phone ownership
 * (the applicant-flow prototype's "No, different person" branch doesn't
 * really apply once OTP verification is real rather than mocked). If a
 * legacyBusinessId was passed (the renewal legacy-claim path, CLAUDE.md
 * section 5) and it's still unclaimed, it gets linked to whichever owner
 * this phone resolves to -- a brand-new owner gets the legacy record's
 * name, an already-existing owner just gains the business.
 *
 * The claim step is resolved BEFORE, and independently of, whether an
 * owner already existed for this phone (2026-08-16 follow-up -- a real
 * bug, not hypothetical): the previous version only ran the claim inside
 * the "no existing owner" branch, so a retry after an earlier failed
 * phone-sign-in attempt for the same number (which already creates a
 * bare owner row with no business attached, see the "renewal_license"
 * screen's "sign in with your phone instead" link) could never actually
 * claim the business afterward -- the owner now "existed" by the time the
 * retry ran, so the claim was silently skipped and the applicant hit a
 * confusing "not yours" error only once they tried to submit. Same root
 * cause blocked an owner with more than one still-unclaimed legacy
 * business from ever claiming a second one via License Number lookup,
 * once their phone already had an owner row from claiming the first.
 *
 * Identity (First/Last Name, Email, Gender) now lives directly on the main
 * application form itself -- pre-filled here from whatever's on file (blank
 * for a brand-new owner) -- rather than gating on a separate "identity"
 * screen the way this used to work. This route's job is just to report
 * what's on file today so the client can pre-fill; the form's own submit
 * writes any corrections back to the owners row.
 *
 * `businessId` (2026-08-16 follow-up, Permit Number renewal lookup): an
 * alternative to the client supplying `phone` directly. When present, the
 * phone this OTP is checked against is resolved server-side from that
 * business's own linked owner -- the client never learns or sends the real
 * number, only ever a masked hint for display (lookup-license/route.ts).
 * Everything after that resolves identically to the phone-sign-in path,
 * since by construction this business's owner already exists.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const code = String(body?.code ?? "");
  const legacyBusinessId: string | undefined = body?.legacyBusinessId || undefined;
  const renewalBusinessId: string | undefined = body?.businessId || undefined;

  const supabase = createServiceClient();

  let phone = normalizePhone(body?.phone ?? "");
  if (renewalBusinessId) {
    const { data: business } = await supabase
      .from("businesses")
      .select("owner:owners(phone)")
      .eq("id", renewalBusinessId)
      .maybeSingle();
    const owner = business?.owner as unknown as { phone: string | null } | null;
    if (!owner?.phone) {
      return NextResponse.json({ error: "business_not_found" }, { status: 400 });
    }
    phone = owner.phone;
  }

  if (!phone || !code) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const ok = await verifyOtp(phone, code);
  if (!ok) {
    return NextResponse.json({ error: "invalid_or_expired_code" }, { status: 400 });
  }

  let legacyBusiness: { id: string; legacy_owner_name: string | null } | null = null;
  if (legacyBusinessId) {
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id, legacy_owner_name")
      .eq("id", legacyBusinessId)
      .eq("is_legacy_unclaimed", true)
      .maybeSingle();
    if (businessError || !business) {
      return NextResponse.json({ error: "legacy_business_not_found" }, { status: 400 });
    }
    legacyBusiness = business;
  }

  const { data: existingOwner } = await supabase
    .from("owners")
    .select("id, full_name, email, gender")
    .eq("phone", phone)
    .maybeSingle();

  let ownerId: string;
  let ownerName: string;
  let ownerEmail: string | null = null;
  let ownerGender: string | null = null;
  const matched = Boolean(existingOwner);

  if (existingOwner) {
    ownerId = existingOwner.id;
    ownerName = existingOwner.full_name;
    ownerEmail = existingOwner.email;
    ownerGender = existingOwner.gender;
  } else {
    const nameForOwner = legacyBusiness?.legacy_owner_name || phone;
    const { data: newOwner, error: ownerError } = await supabase
      .from("owners")
      .insert({
        full_name: nameForOwner,
        phone,
        ...(legacyBusiness ? { claimed_at: new Date().toISOString() } : {}),
      })
      .select("id, full_name")
      .single();
    if (ownerError || !newOwner) {
      return NextResponse.json({ error: "owner_create_failed" }, { status: 500 });
    }
    ownerId = newOwner.id;
    // Placeholder (= phone) when there's no legacy name to adopt -- the
    // form's own identity fields ask for their real one.
    ownerName = newOwner.full_name;
  }

  if (legacyBusiness) {
    const { error: claimError } = await supabase
      .from("businesses")
      .update({ owner_id: ownerId, is_legacy_unclaimed: false })
      .eq("id", legacyBusiness.id);
    if (claimError) {
      return NextResponse.json({ error: "business_claim_failed" }, { status: 500 });
    }
  }

  const { count: businessCount } = await supabase
    .from("businesses")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId);

  const token = await createApplicantSession(ownerId);
  const cookieStore = await cookies();
  cookieStore.set(applicantSessionCookieOptions().name, token, applicantSessionCookieOptions());

  return NextResponse.json({
    matched,
    ownerName,
    ownerEmail,
    ownerGender,
    businessCount: businessCount ?? 0,
  });
}
