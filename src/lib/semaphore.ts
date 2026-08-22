/**
 * Semaphore SMS client (https://semaphore.co) -- CLAUDE.md's chosen SMS
 * provider for OTP codes and status notifications. Server-only: uses
 * SEMAPHORE_API_KEY, never exposed to the browser.
 *
 * `senderName` (added for per-LGU Sender Names) maps directly to
 * Semaphore's own `sendername` parameter -- confirmed against their API
 * docs, not assumed: one account can hold several approved Sender Names,
 * and each message picks which one via this parameter, falling back to
 * the account's own default Sender Name when omitted. No separate API
 * key/account needed per LGU -- see lgus.sender_name's migration comment
 * (0040) for the full reasoning.
 */
export async function sendSms(phone: string, message: string, senderName?: string | null): Promise<void> {
  const apiKey = process.env.SEMAPHORE_API_KEY;
  if (!apiKey) {
    throw new Error("SEMAPHORE_API_KEY is not set");
  }

  const response = await fetch("https://api.semaphore.co/api/v4/messages", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      apikey: apiKey,
      number: phone,
      message,
      ...(senderName ? { sendername: senderName } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Semaphore send failed (${response.status}): ${body}`);
  }
}

export function otpMessage(code: string): string {
  return `Your verification code is ${code}. This code expires in 5 minutes. Do not share this code with anyone.`;
}
