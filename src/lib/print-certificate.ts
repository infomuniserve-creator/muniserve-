import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { LguDisplay } from "@/lib/lgu";
import { centerText, centerTextInRange, drawLabelValueRow, wrapText } from "@/lib/pdf-doc-utils";

/**
 * Generates the PRE-signature certificate shown at "For Printing"
 * (pending_printing) -- open the queue card, the PDF is already filled
 * with the permit number, business details, and payment info, click
 * print. Deliberately a SEPARATE document from generatePermitAssets()
 * (permit-pdf.ts), which generates the post-signing PDF with the QR
 * verification code once the Mayor (or BPLO on their behalf, CLAUDE.md
 * 7w) actually signs -- the project owner's own explicit call, since this
 * one has no signature or QR yet (it isn't legally issued until signing)
 * and exists purely as BPLO's own printable paper copy to carry over.
 *
 * Built directly against a real physical San Miguel Business Permit
 * (photographed by the project owner, 2026-08-15) for field content,
 * wording, and layout order -- NOT a pixel-exact recreation of that
 * document's actual graphic design (the diagonal color panels, embossed
 * year watermark, and the real municipal/Philippine seal artwork are a
 * professional design asset this can't reproduce from a phone photo with
 * any fidelity). Reuses this codebase's own established visual system
 * (permit-pdf.ts's navy banner + label/value rows) instead of guessing at
 * a knockoff of the real graphic design -- a reasonable first draft to
 * adjust from, not a final pixel-locked design, same framing permit-
 * pdf.ts already uses for the other certificate.
 *
 * Deliberately genericized/omitted for multi-tenant safety, flagged
 * rather than silently guessed (same standing rule as CLAUDE.md 7b/7d/7h
 * for fee rates and form fields -- never invent a legal specific for an
 * LGU that hasn't confirmed it):
 *   - The real reference cites a specific ordinance/resolution number
 *     ("Ordinance No. 077", "Resolution No. 92A-177") and a specific
 *     renewal-deadline citation -- these are San Miguel's own real legal
 *     citations, not safe to assume for a future second LGU. Left out of
 *     the generic body text; only the January 20 renewal-deadline pattern
 *     (a real, common LGU convention, not invented) is kept, with the
 *     year computed rather than hardcoded.
 *   - The reference's own decorative footer (LGU tagline, Facebook page,
 *     specific email) is real marketing content for that LGU, not
 *     something to copy for every client. Omitted; a small MuniServe
 *     attribution line takes its place, matching permit-pdf.ts's own
 *     footer convention.
 */

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const NAVY = rgb(0x0c / 255, 0x4d / 255, 0xa2 / 255);
const INK = rgb(0.1, 0.1, 0.18);
const MUTED = rgb(0.42, 0.45, 0.5);

export type PrintCertificateInput = {
  referenceNumber: string;
  applicationType: "new" | "renewal";
  businessName: string;
  ownerName: string;
  address: string;
  receiptNo: string | null;
  amountPaid: number | null;
  issuedOn: Date;
  applicationYear: number;
  lgu: LguDisplay;
};

/**
 * The fixed set of data points a print template (generated or custom-
 * uploaded, CLAUDE.md 7y) can place -- the canonical vocabulary a BPLO's
 * own field-mapping screen offers, and the single source of truth both
 * generatePrePrintCertificate() and fillCustomTemplate() (print-template-
 * fill.ts) compute values from, so the two paths can't drift apart on
 * date/currency formatting the way two independent implementations
 * eventually would.
 */
export const PRINT_TEMPLATE_FIELDS = [
  { key: "permit_number", label: "Permit Number" },
  { key: "application_type", label: "Application Type (NEW / RENEWAL)" },
  { key: "business_name", label: "Registered Trade Name / Business Name" },
  { key: "business_address", label: "Business Address" },
  { key: "business_owner", label: "Business Owner" },
  { key: "receipt_no", label: "Receipt No." },
  { key: "amount_paid", label: "Amount Paid" },
  { key: "issued_on", label: "Issued On" },
  { key: "valid_until", label: "Valid Until" },
  { key: "renew_by", label: "Renewal Deadline" },
  { key: "mayor_name", label: "Mayor's Name" },
  { key: "mayor_title", label: "Mayor's Title (City/Municipal Mayor)" },
] as const;
export type PrintTemplateFieldKey = (typeof PRINT_TEMPLATE_FIELDS)[number]["key"];

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" });
}

/** A date-only string ("2026-12-31") parses as UTC midnight -- noon UTC avoids the day-before rollover a negative-UTC-offset timezone would otherwise cause. Same trap/fix permit-pdf.ts's formatDate already documents. */
function formatDateOnly(isoDate: string): string {
  return formatDate(new Date(`${isoDate}T12:00:00Z`));
}

/**
 * Computes every canonical field's display-ready string for one
 * application -- "Php" not "₱" (see the note further down: pdf-lib's
 * standard fonts can't encode the peso symbol at all), dates already
 * formatted, application type already uppercased. Both the generated
 * certificate and a custom-uploaded one fill in exactly these strings,
 * never their own separate formatting.
 */
export function computeCertificateFieldValues(input: PrintCertificateInput): Record<PrintTemplateFieldKey, string> {
  const isCity = /\bcity\b/i.test(input.lgu.bploOfficeName);
  return {
    permit_number: input.referenceNumber,
    application_type: input.applicationType === "renewal" ? "RENEWAL" : "NEW",
    business_name: input.businessName,
    business_address: input.address || "—",
    business_owner: input.ownerName,
    receipt_no: input.receiptNo ?? "—",
    amount_paid: input.amountPaid != null ? `Php ${input.amountPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—",
    issued_on: formatDate(input.issuedOn),
    valid_until: formatDateOnly(`${input.applicationYear}-12-31`),
    renew_by: formatDateOnly(`${input.applicationYear + 1}-01-20`),
    mayor_name: input.lgu.mayorName ? `HON. ${input.lgu.mayorName.toUpperCase()}` : "",
    mayor_title: isCity ? "City Mayor" : "Municipal Mayor",
  };
}

export async function generatePrePrintCertificate(input: PrintCertificateInput): Promise<Uint8Array> {
  const values = computeCertificateFieldValues(input);
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const isCity = /\bcity\b/i.test(input.lgu.bploOfficeName);
  const officeTitle = isCity ? "OFFICE OF THE CITY MAYOR" : "OFFICE OF THE MUNICIPAL MAYOR";

  // --- Letterhead banner ---
  const bannerHeight = 118;
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - bannerHeight, width: PAGE_WIDTH, height: bannerHeight, color: NAVY });

  let y = PAGE_HEIGHT - 30;
  centerText(page, PAGE_WIDTH, "Republic of the Philippines", y, font, 11, rgb(1, 1, 1));
  y -= 15;
  if (input.lgu.province) {
    centerText(page, PAGE_WIDTH, `Province of ${input.lgu.province}`, y, font, 11, rgb(1, 1, 1));
    y -= 15;
  }
  centerText(page, PAGE_WIDTH, input.lgu.displayName, y, font, 11, rgb(1, 1, 1));
  y -= 16;
  centerText(page, PAGE_WIDTH, officeTitle, y, bold, 10, rgb(1, 1, 1));
  y -= 26;
  centerText(page, PAGE_WIDTH, "BUSINESS PERMIT", y, bold, 22, rgb(1, 1, 1));

  // --- Permit No. + application type, prominent, right under the banner ---
  y = PAGE_HEIGHT - bannerHeight - 32;
  centerText(page, PAGE_WIDTH, `Permit No. ${values.permit_number}`, y, bold, 15, NAVY);
  y -= 18;
  centerText(page, PAGE_WIDTH, values.application_type, y, bold, 11, MUTED);

  // --- Details table ---
  // "Php" not "₱" (caught by actually rendering a test PDF, not just
  // reading the code): pdf-lib's standard Helvetica font uses WinAnsi
  // encoding, which has no glyph for U+20B1 and throws outright when
  // asked to draw it. The real reference certificate writes "Php." too,
  // not the peso symbol, so this isn't a workaround-vs-ideal tradeoff --
  // it's just what the actual document does (see computeCertificateFieldValues).
  y -= 40;
  const rows: [string, string][] = [
    ["Registered trade name", values.business_name],
    ["Business address", values.business_address],
    ["Business owner", values.business_owner],
    ["Receipt No.", values.receipt_no],
    ["Amount paid", values.amount_paid],
    ["Issued on", values.issued_on],
  ];
  for (const [label, value] of rows) {
    y = drawLabelValueRow(page, y, {
      label, value,
      labelX: MARGIN, valueX: MARGIN + 180, valueMaxWidth: PAGE_WIDTH - MARGIN - 180 - MARGIN,
      labelFont: bold, labelSize: 10.5, labelColor: MUTED,
      valueFont: font, valueSize: 11, valueColor: INK,
      lineGap: 14, rowPadding: 12,
    });
  }

  // --- Disclaimer ---
  y -= 14;
  const disclaimerLines = wrapText(
    `This Business Permit is revocable and is null and void if the permittee violates any applicable law, ordinance, or regulation, or fails to pay any tax, fee, or charge as they become due. Valid until ${values.valid_until}.`,
    font,
    10,
    PAGE_WIDTH - MARGIN * 2
  );
  for (const line of disclaimerLines) {
    page.drawText(line, { x: MARGIN, y, font, size: 10, color: INK });
    y -= 14;
  }

  // --- Note block ---
  y -= 8;
  const noteLines = wrapText(
    `NOTE: This permit must be posted in a conspicuous place at the business premises. Violation of any provision of the Revenue Code of ${input.lgu.displayName} shall cause revocation of this permit and forfeiture of all sums paid for the right granted, in addition to the penalties provided under the ordinance.`,
    bold,
    8.5,
    PAGE_WIDTH - MARGIN * 2
  );
  for (const line of noteLines) {
    page.drawText(line, { x: MARGIN, y, font: bold, size: 8.5, color: MUTED });
    y -= 12;
  }

  // --- Signature block (blank -- this is the pre-signature copy) ---
  const sigY = 175;
  page.drawLine({ start: { x: PAGE_WIDTH - MARGIN - 220, y: sigY }, end: { x: PAGE_WIDTH - MARGIN, y: sigY }, thickness: 1, color: INK });
  if (values.mayor_name) {
    centerTextInRange(page, values.mayor_name, PAGE_WIDTH - MARGIN - 220, PAGE_WIDTH - MARGIN, sigY - 14, bold, 10, INK);
  }
  centerTextInRange(page, values.mayor_title, PAGE_WIDTH - MARGIN - 220, PAGE_WIDTH - MARGIN, sigY - 28, font, 9, MUTED);

  // --- Legal basis ---
  const basisLines = wrapText(
    `Having complied with the requirements of the Revenue Code of ${input.lgu.displayName}. This permit must be renewed on or before ${values.renew_by}, unless sooner revoked for cause.`,
    font,
    9,
    PAGE_WIDTH - MARGIN * 2 - 240
  );
  let basisY = sigY - 14;
  for (const line of basisLines) {
    page.drawText(line, { x: MARGIN, y: basisY, font, size: 9, color: INK });
    basisY -= 12;
  }

  // --- Footer ---
  page.drawText("Pending Mayor's signature.", { x: MARGIN, y: 40, font, size: 8, color: MUTED });

  return pdfDoc.save();
}
