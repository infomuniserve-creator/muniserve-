import { sendOtpCode } from "@/lib/otp";
import { normalizePhone } from "@/lib/phone";
import { resolveLguId } from "@/lib/lgu";
import { checkOtpIpRateLimit, getClientIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

/** Sends a fresh OTP by SMS to a client-supplied phone (the "new business" and "sign in with your phone" paths -- see send-renewal-otp/route.ts for the Permit Number lookup's own variant, which never trusts a client-supplied phone). */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const phone = normalizePhone(body?.phone ?? "");
  if (!phone) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }

  // Per-IP throttle (2026-08-20 audit finding), on top of sendOtpCode's own
  // existing per-phone-number cooldown -- this is the one OTP-send path
  // where the destination phone is entirely client-supplied, so it's the
  // real abuse surface (a script working through many different numbers,
  // each a real billed SMS to a real third party). See rate-limit.ts.
  const clientIp = getClientIp(request);
  const allowed = await checkOtpIpRateLimit(clientIp);
  if (!allowed) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  // No business/application exists yet at this point (a brand-new
  // applicant, or "sign in with your phone") -- the request's own host
  // is the only real signal for which LGU this SMS should count against.
  const lguId = await resolveLguId(request.headers.get("host"));
  const result = await sendOtpCode(phone, lguId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === "too_soon" ? 429 : 502 });
  }
  return NextResponse.json({ ok: true });
}
