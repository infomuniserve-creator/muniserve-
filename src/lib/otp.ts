import { createServiceClient } from "@/lib/supabase/service";
import { otpMessage, sendSms } from "@/lib/semaphore";

const OTP_TTL_MINUTES = 5;
const MAX_VERIFY_ATTEMPTS = 5;

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Generates and stores a new OTP code for a phone number (or email, for
 * CLAUDE.md rule #10's secondary path -- not wired up yet, phone is
 * primary). Returns the code for the caller to send via Semaphore.
 */
export async function createOtp(phoneOrEmail: string): Promise<string> {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  const supabase = createServiceClient();
  const { error } = await supabase.from("otp_codes").insert({
    phone_or_email: phoneOrEmail,
    code,
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw error;

  return code;
}

/**
 * Verifies a submitted code against the most recent unexpired, unverified
 * OTP for that phone/email. Marks it verified on success so it can't be
 * replayed. Returns false on any mismatch, expiry, already-used code, or
 * a code that's been guessed wrong MAX_VERIFY_ATTEMPTS times already.
 *
 * Looks up the latest active row by phone alone (not by matching the
 * submitted code in the query, like the original version did) so a wrong
 * guess can be counted against that specific row -- attempts only ever
 * accrue against the one code actually in play, not spread across
 * whatever a client happens to submit. A real side effect worth noting:
 * this also means only the most-recently-sent code is ever checkable, not
 * any still-unexpired earlier one -- the correct behavior (there should
 * only ever be one "the code I just got"), and a prerequisite for
 * attempt-counting to mean anything at all.
 */
export async function verifyOtp(phoneOrEmail: string, code: string): Promise<boolean> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("otp_codes")
    .select("id, code, attempts")
    .eq("phone_or_email", phoneOrEmail)
    .is("verified_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return false;
  if (data.attempts >= MAX_VERIFY_ATTEMPTS) return false;

  if (data.code !== code) {
    await supabase.from("otp_codes").update({ attempts: data.attempts + 1 }).eq("id", data.id);
    return false;
  }

  const { error: updateError } = await supabase
    .from("otp_codes")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", data.id);

  return !updateError;
}

export type SendOtpResult = { ok: true } | { error: "too_soon" | "sms_send_failed" };

/**
 * Cooldown-checked OTP send -- one unexpired code per phone's worth of
 * time, so a double-click (or, for the Permit Number renewal lookup, a
 * mistyped number retried a few times) can't stack requests and burn
 * Semaphore credits. Shared by send-otp/route.ts (client-supplied phone)
 * and send-renewal-otp/route.ts (phone resolved server-side from a
 * business's linked owner, 2026-08-16) so both enforce the same guarantee
 * rather than drifting apart as two copies of the same 15 lines.
 */
export async function sendOtpCode(phone: string): Promise<SendOtpResult> {
  const supabase = createServiceClient();
  const { data: recent } = await supabase
    .from("otp_codes")
    .select("created_at")
    .eq("phone_or_email", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent && Date.now() - new Date(recent.created_at).getTime() < 30_000) {
    return { error: "too_soon" };
  }

  const code = await createOtp(phone);
  try {
    await sendSms(phone, otpMessage(code));
  } catch (err) {
    console.error("Semaphore send failed", err);
    return { error: "sms_send_failed" };
  }
  return { ok: true };
}
