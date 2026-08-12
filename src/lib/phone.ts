/**
 * Normalizes Philippine mobile numbers to the local 11-digit format
 * (09XXXXXXXXX) used throughout the schema and the applicant flow
 * prototype -- accepts "+639171234567", "639171234567", "09171234567",
 * or the same with spaces/dashes, and returns null if it doesn't look
 * like a valid PH mobile number.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^0-9]/g, "");

  let normalized: string;
  if (digits.startsWith("63") && digits.length === 12) {
    normalized = "0" + digits.slice(2);
  } else if (digits.startsWith("9") && digits.length === 10) {
    normalized = "0" + digits;
  } else if (digits.startsWith("09") && digits.length === 11) {
    normalized = digits;
  } else {
    return null;
  }

  return /^09\d{9}$/.test(normalized) ? normalized : null;
}
