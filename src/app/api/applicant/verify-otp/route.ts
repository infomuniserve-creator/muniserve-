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
 * really apply once OTP verification is real rather than mocked). If no
 * match and a legacyBusinessId was passed (the renewal legacy-claim path,
 * CLAUDE.md section 5), the owner is created from that record's name and
 * the business is claimed atomically. Otherwise a placeholder-named owner
 * is created and the client is told to collect a real name next.
 *
 * Identity (First/Last Name, Email, Gender) now lives directly on the main
 * application form itself -- pre-filled here from whatever's on file (blank
 * for a brand-new owner) -- rather than gating on a separate "identity"
 * screen the way this used to work. This route's job is just to report
 * what's on file today so the client can pre-fill; the form's own submit
 * writes any corrections back to the owners row.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const phone = normalizePhone(body?.phone ?? "");
  const code = String(body?.code ?? "");
  const legacyBusinessId: string | undefined = body?.legacyBusinessId || undefined;

  if (!phone || !code) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const ok = await verifyOtp(phone, code);
  if (!ok) {
    return NextResponse.json({ error: "invalid_or_expired_code" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: existingOwner } = await supabase
    .from("owners")
    .select("id, full_name, email, gender")
    .eq("phone", phone)
    .maybeSingle();

  let ownerId: string;
  let ownerName: string;
  let ownerEmail: string | null = null;
  let ownerGender: string | null = null;
  let matched: boolean;

  if (existingOwner) {
    ownerId = existingOwner.id;
    ownerName = existingOwner.full_name;
    ownerEmail = existingOwner.email;
    ownerGender = existingOwner.gender;
    matched = true;
  } else {
    matched = false;

    if (legacyBusinessId) {
      const { data: business, error: businessError } = await supabase
        .from("businesses")
        .select("id, legacy_owner_name, is_legacy_unclaimed")
        .eq("id", legacyBusinessId)
        .eq("is_legacy_unclaimed", true)
        .maybeSingle();

      if (businessError || !business) {
        return NextResponse.json({ error: "legacy_business_not_found" }, { status: 400 });
      }

      const nameForOwner = business.legacy_owner_name || phone;
      const { data: newOwner, error: ownerError } = await supabase
        .from("owners")
        .insert({ full_name: nameForOwner, phone, claimed_at: new Date().toISOString() })
        .select("id, full_name")
        .single();
      if (ownerError || !newOwner) {
        return NextResponse.json({ error: "owner_create_failed" }, { status: 500 });
      }

      const { error: claimError } = await supabase
        .from("businesses")
        .update({ owner_id: newOwner.id, is_legacy_unclaimed: false })
        .eq("id", legacyBusinessId);
      if (claimError) {
        return NextResponse.json({ error: "business_claim_failed" }, { status: 500 });
      }

      ownerId = newOwner.id;
      ownerName = newOwner.full_name;
    } else {
      const { data: newOwner, error: ownerError } = await supabase
        .from("owners")
        .insert({ full_name: phone, phone })
        .select("id, full_name")
        .single();
      if (ownerError || !newOwner) {
        return NextResponse.json({ error: "owner_create_failed" }, { status: 500 });
      }
      ownerId = newOwner.id;
      ownerName = newOwner.full_name; // placeholder (= phone) -- the form's own identity fields ask for their real one
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
