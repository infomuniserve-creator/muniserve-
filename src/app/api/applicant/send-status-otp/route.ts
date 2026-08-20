import { sendOtpCode } from "@/lib/otp";
import { createServiceClient } from "@/lib/supabase/service";
import { checkOtpIpRateLimit, getClientIp } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

/**
 * Sends an OTP to re-verify an applicant on a browser/device that doesn't
 * hold the `applicant_session` cookie set at submission time (status/
 * [reference]'s own "Can't verify this application here" branch -- the
 * cookie only ever exists in the one browser that filed it). The phone is
 * resolved server-side from the application's own business/owner, never
 * accepted from the client -- same guarantee as send-renewal-otp.ts.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const applicationId = String(body?.applicationId ?? "").trim();
  if (!applicationId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // Same per-IP throttle as send-otp/route.ts (2026-08-20 audit finding) --
  // lower risk here since the destination phone is already server-resolved
  // rather than client-supplied, but defense-in-depth is cheap and this is
  // still a real, billed SMS per call.
  if (!(await checkOtpIpRateLimit(getClientIp(request)))) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  const supabase = createServiceClient();
  const { data: application } = await supabase
    .from("applications")
    .select("lgu_id, business:businesses(owner:owners(phone))")
    .eq("id", applicationId)
    .maybeSingle();
  const owner = (application?.business as unknown as { owner: { phone: string | null } | null } | null)?.owner ?? null;
  if (!owner?.phone || !application?.lgu_id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await sendOtpCode(owner.phone, application.lgu_id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === "too_soon" ? 429 : 502 });
  }
  return NextResponse.json({ ok: true });
}
