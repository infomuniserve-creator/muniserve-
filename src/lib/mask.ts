/** "Milagros King Buenaventura" -> "M******* K*** B************" -- matches the masking in reference/MuniServe_Applicant_Flow_Prototype.html's maskName(). */
export function maskName(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0] + "*".repeat(Math.max(1, part.length - 1)))
    .join(" ");
}
