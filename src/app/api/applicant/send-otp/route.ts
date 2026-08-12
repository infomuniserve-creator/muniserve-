import { createOtp } from "@/lib/otp";
import { normalizePhone } from "@/lib/phone";
import { otpMessage, sendSms } from "@/lib/semaphore";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

/**
 * Sends a fresh OTP by SMS. A simple cooldown (one unexpired code per
 * phone number's worth of time, i.e. don't let a resend request stack a
 * second code within the same 5-minute window's first 30 seconds) keeps
 * an impatient double-click from burning two Semaphore credits.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const phone = normalizePhone(body?.phone ?? "");
  if (!phone) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: recent } = await supabase
    .from("otp_codes")
    .select("created_at")
    .eq("phone_or_email", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent && Date.now() - new Date(recent.created_at).getTime() < 30_000) {
    return NextResponse.json({ error: "too_soon" }, { status: 429 });
  }

  const code = await createOtp(phone);

  try {
    await sendSms(phone, otpMessage(code));
  } catch (err) {
    console.error("Semaphore send failed", err);
    return NextResponse.json({ error: "sms_send_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
