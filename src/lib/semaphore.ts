/**
 * Semaphore SMS client (https://semaphore.co) -- CLAUDE.md's chosen SMS
 * provider for OTP codes and status notifications. Server-only: uses
 * SEMAPHORE_API_KEY, never exposed to the browser.
 */
export async function sendSms(phone: string, message: string): Promise<void> {
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
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Semaphore send failed (${response.status}): ${body}`);
  }
}

export function otpMessage(code: string): string {
  return `Your MuniServe verification code is ${code}. This code expires in 5 minutes. Do not share this code with anyone.`;
}
