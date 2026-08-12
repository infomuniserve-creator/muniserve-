import { createServiceClient } from "@/lib/supabase/service";

const OTP_TTL_MINUTES = 5;

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
 * replayed. Returns false on any mismatch, expiry, or already-used code.
 */
export async function verifyOtp(phoneOrEmail: string, code: string): Promise<boolean> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("otp_codes")
    .select("id, expires_at")
    .eq("phone_or_email", phoneOrEmail)
    .eq("code", code)
    .is("verified_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return false;

  const { error: updateError } = await supabase
    .from("otp_codes")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", data.id);

  return !updateError;
}
