import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { LguDisplay } from "@/lib/lgu";

/**
 * The itemized assessment slip BPLO hands (or emails) to an applicant right
 * after finalizing their assessment -- what the applicant shows the
 * Treasurer to pay. Built directly against a real physical San Miguel
 * "Order of Payment" the project owner photographed (CLAUDE.md 7cc-onward
 * standing rule: read the actual document, don't invent one) -- same
 * "reasonable first draft, not pixel-exact" framing already established for
 * print-certificate.ts's own from-photo document (that file's own doc
 * comment explains why: no way to reproduce a real form's graphic design
 * from a phone photo with any fidelity, only its field set/wording/order).
 *
 * Deliberately reads from `application_fee_lines` (the rows written at
 * finalize time), never re-running computeApplicationFees() -- this needs
 * to be reprint-accurate months later even if fee_rules changes in the
 * meantime, same reasoning application_fee_lines.fee_category/display_label
 * /acct_code are denormalized at write time in the first place (CLAUDE.md
 * 7r/migration 0039's own comments).
 *
 * Blank-field defaults below are deliberate, not omissions -- each was a
 * locked-in decision with the project owner before this was built:
 *   - Plate No.: left off the document entirely (no reuse of
 *     reference_number, no new counter).
 *   - CTC #/Issued On/Issued At, SSS No., SEC/DTI Date Issued: rendered as
 *     blank lines. MuniServe captures no CEDULA control number, and the
 *     applicant form only collects one combined registrationAuthority +
 *     registrationNo (no per-authority date fields, no SSS field at all).
 *   - "Reviewed & Recommended for Approval": prints lgu.treasurerName as a
 *     plain printed name/title, no approval workflow gate behind it.
 */

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const NAVY = rgb(0x0c / 255, 0x4d / 255, 0xa2 / 255);
const INK = rgb(0.1, 0.1, 0.18);
const MUTED = rgb(0.42, 0.45, 0.5);

export type OrderOfPaymentLine = {
  acctCode: string | null;
  displayLabel: string;
  amount: number;
};

export type OrderOfPaymentInput = {
  referenceNumber: string;
  applicationType: "new" | "renewal";
  businessName: string;
  ownerName: string;
  address: string;
  modeOfPayment: string | null;
  assessedByName: string | null;
  assessedOn: Date;
  lines: OrderOfPaymentLine[];
  totalDue: number;
  lgu: LguDisplay;
};

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" });
}

function formatPeso(amount: number): string {
  // "Php" not "₱" -- pdf-lib's standard Helvetica (WinAnsi encoding) has no
  // glyph for U+20B1 and throws outright. Same convention permit-pdf.ts and
  // print-certificate.ts already use.
  return `Php ${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

export async function generateOrderOfPaymentPdf(input: OrderOfPaymentInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // --- Letterhead banner ---
  const bannerHeight = 110;
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - bannerHeight, width: PAGE_WIDTH, height: bannerHeight, color: NAVY });

  let y = PAGE_HEIGHT - 28;
  centerText(page, "Republic of the Philippines", y, font, 10.5, rgb(1, 1, 1));
  y -= 14;
  if (input.lgu.province) {
    centerText(page, `Province of ${input.lgu.province}`, y, font, 10.5, rgb(1, 1, 1));
    y -= 14;
  }
  centerText(page, input.lgu.displayName, y, font, 10.5, rgb(1, 1, 1));
  y -= 15;
  centerText(page, input.lgu.bploOfficeName.toUpperCase(), y, bold, 9.5, rgb(1, 1, 1));
  y -= 24;
  centerText(page, "ORDER OF PAYMENT", y, bold, 20, rgb(1, 1, 1));

  // --- Permit No. + type + date, right under the banner ---
  y = PAGE_HEIGHT - bannerHeight - 30;
  page.drawText(`Permit No. ${input.referenceNumber}`, { x: MARGIN, y, font: bold, size: 12, color: NAVY });
  const typeLabel = input.applicationType === "renewal" ? "RENEWAL" : "NEW";
  const typeWidth = bold.widthOfTextAtSize(typeLabel, 10);
  page.drawText(typeLabel, { x: PAGE_WIDTH - MARGIN - typeWidth, y: y + 1, font: bold, size: 10, color: MUTED });
  y -= 16;
  page.drawText(`Date: ${formatDate(input.assessedOn)}`, { x: MARGIN, y, font, size: 10, color: MUTED });

  // --- Business / owner details ---
  y -= 30;
  const detailRows: [string, string][] = [
    ["Business name", input.businessName],
    ["Business address", input.address || "—"],
    ["Business owner", input.ownerName],
    ["Mode of payment", input.modeOfPayment ?? "—"],
  ];
  for (const [label, value] of detailRows) {
    page.drawText(label, { x: MARGIN, y, font: bold, size: 10, color: MUTED });
    page.drawText(value, { x: MARGIN + 150, y, font, size: 10.5, color: INK, maxWidth: PAGE_WIDTH - MARGIN - 150 - MARGIN });
    y -= 20;
  }

  // --- Itemized assessment table ---
  y -= 12;
  const tableTop = y;
  const colAcct = MARGIN;
  const colParticulars = MARGIN + 70;
  const colAmount = PAGE_WIDTH - MARGIN - 90;
  page.drawLine({ start: { x: MARGIN, y: tableTop + 4 }, end: { x: PAGE_WIDTH - MARGIN, y: tableTop + 4 }, thickness: 1, color: INK });
  page.drawText("Acct Code", { x: colAcct, y: tableTop - 10, font: bold, size: 9.5, color: MUTED });
  page.drawText("Particulars", { x: colParticulars, y: tableTop - 10, font: bold, size: 9.5, color: MUTED });
  page.drawText("Amount", { x: colAmount, y: tableTop - 10, font: bold, size: 9.5, color: MUTED });
  y = tableTop - 22;
  page.drawLine({ start: { x: MARGIN, y: y + 8 }, end: { x: PAGE_WIDTH - MARGIN, y: y + 8 }, thickness: 0.5, color: MUTED });

  for (const line of input.lines) {
    const labelLines = wrapText(line.displayLabel, font, 10, colAmount - colParticulars - 12);
    const rowHeight = Math.max(16, labelLines.length * 13);
    page.drawText(line.acctCode ?? "—", { x: colAcct, y, font, size: 10, color: INK });
    let ly = y;
    for (const l of labelLines) {
      page.drawText(l, { x: colParticulars, y: ly, font, size: 10, color: INK });
      ly -= 13;
    }
    const amountText = formatPeso(line.amount);
    const amountWidth = font.widthOfTextAtSize(amountText, 10);
    page.drawText(amountText, { x: PAGE_WIDTH - MARGIN - amountWidth, y, font, size: 10, color: INK });
    y -= rowHeight;
  }

  y -= 4;
  page.drawLine({ start: { x: MARGIN, y: y + 8 }, end: { x: PAGE_WIDTH - MARGIN, y: y + 8 }, thickness: 1, color: INK });
  y -= 8;
  const totalText = formatPeso(input.totalDue);
  const totalWidth = bold.widthOfTextAtSize(totalText, 12);
  page.drawText("TOTAL AMOUNT DUE", { x: MARGIN, y, font: bold, size: 11, color: NAVY });
  page.drawText(totalText, { x: PAGE_WIDTH - MARGIN - totalWidth, y: y - 1, font: bold, size: 12, color: NAVY });

  // --- Blank reference fields (no data source yet -- left blank, not guessed) ---
  y -= 40;
  const blankLines: [string, string][] = [
    ["CTC No.", ""],
    ["CTC Issued On", ""],
    ["CTC Issued At", ""],
    ["SSS No.", ""],
    ["SEC/DTI Date Issued", ""],
  ];
  for (const [label] of blankLines) {
    page.drawText(`${label}:`, { x: MARGIN, y, font, size: 9, color: MUTED });
    page.drawLine({ start: { x: MARGIN + 120, y: y - 2 }, end: { x: MARGIN + 320, y: y - 2 }, thickness: 0.5, color: MUTED });
    y -= 16;
  }

  // --- Signature block ---
  const sigY = 110;
  const leftSigX = MARGIN;
  const rightSigX = PAGE_WIDTH / 2 + 10;
  page.drawLine({ start: { x: leftSigX, y: sigY }, end: { x: leftSigX + 200, y: sigY }, thickness: 1, color: INK });
  page.drawText(input.assessedByName ?? "", { x: leftSigX, y: sigY - 14, font: bold, size: 10, color: INK });
  page.drawText("Assessed by", { x: leftSigX, y: sigY - 28, font, size: 9, color: MUTED });

  page.drawLine({ start: { x: rightSigX, y: sigY }, end: { x: rightSigX + 200, y: sigY }, thickness: 1, color: INK });
  page.drawText(input.lgu.treasurerName ?? "", { x: rightSigX, y: sigY - 14, font: bold, size: 10, color: INK });
  page.drawText("Reviewed & Recommended for Approval", { x: rightSigX, y: sigY - 28, font, size: 9, color: MUTED });

  page.drawText("Generated by MuniServe.", { x: MARGIN, y: 40, font, size: 8, color: MUTED });

  return pdfDoc.save();
}

function centerText(page: PDFPage, text: string, y: number, font: PDFFont, size: number, color: ReturnType<typeof rgb>) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (PAGE_WIDTH - width) / 2, y, font, size, color });
}

/** Naive word-wrap by measured width -- same approach print-certificate.ts/permit-pdf.ts already use. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}
