import { sendOtpCode } from "@/lib/otp";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

/**
 * Sends an OTP for the Permit Number renewal lookup (2026-08-16) -- the
 * destination phone is resolved server-side from `businessId`'s own linked
 * owner, never accepted from the client. Pairs with lookup-license/route.ts
 * (which only ever hands the client a masked hint, never the real number)
 * and verify-otp/route.ts's own `businessId` branch, which resolves the
 * same way so the OTP is checked against the number it was actually sent
 * to. Only meaningful for an already-claimed business (has a real owner
 * with a phone) -- a still-unclaimed one has no phone to send to, and goes
 * through the existing claim path (a NEW phone the applicant supplies)
 * instead.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const businessId = String(body?.businessId ?? "").trim();
  if (!businessId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("owner:owners(phone)")
    .eq("id", businessId)
    .maybeSingle();
  const owner = business?.owner as unknown as { phone: string | null } | null;
  if (!owner?.phone) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await sendOtpCode(owner.phone);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === "too_soon" ? 429 : 502 });
  }
  return NextResponse.json({ ok: true });
}
