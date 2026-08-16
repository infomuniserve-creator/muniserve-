/** "Milagros King Buenaventura" -> "M******* K*** B************" -- matches the masking in reference/MuniServe_Applicant_Flow_Prototype.html's maskName(). */
export function maskName(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0] + "*".repeat(Math.max(1, part.length - 1)))
    .join(" ");
}

/** "09774401374" -> "•••••••1374" -- last 4 digits only, enough for someone to recognize their own number without exposing the whole thing to anyone who just knows a License Number. */
export function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  return "•".repeat(phone.length - 4) + phone.slice(-4);
}
