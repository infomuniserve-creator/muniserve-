import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import type { LguDisplay } from "@/lib/lgu";

/**
 * Generates the permit certificate PDF + its QR code image, at signing
 * time (mayor/actions.ts's signPermit). No real BPLO permit template
 * exists to match (confirmed with the project owner -- CLAUDE.md 7k), so
 * this is a from-scratch design: letterhead matching apply/page.tsx's
 * LguBanner, permit details, a QR code linking to the public /verify/
 * page, and a signature line. Meant as a reasonable first draft to
 * adjust from, not a final pixel-locked design.
 *
 * Pure-JS (pdf-lib + qrcode, no native deps like Puppeteer/Chromium) so
 * this runs fine in a Vercel serverless function without extra
 * configuration.
 *
 * Letterhead comes from the caller's LguDisplay (CLAUDE.md 7n), not a
 * hardcoded "San Miguel" string -- only "Republic of the Philippines" is
 * a true constant here, since every LGU this app serves is Philippine by
 * definition.
 */

const PAGE_WIDTH = 612; // Letter, points (8.5in x 72)
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const NAVY = rgb(0x0c / 255, 0x4d / 255, 0xa2 / 255);
const INK = rgb(0.1, 0.1, 0.18);
const MUTED = rgb(0.42, 0.45, 0.5);

export type PermitPdfInput = {
  referenceNumber: string;
  businessName: string;
  ownerName: string;
  applicationType: "new" | "renewal";
  natureOfBusiness: string | null;
  address: string;
  issuedAt: Date;
  validUntil: string; // YYYY-MM-DD
  verifyUrl: string;
  lgu: LguDisplay;
};

/**
 * Formats a date for display on the certificate. Two timezone traps
 * avoided here, not just one: a date-only string ("2026-12-31") parses
 * as UTC midnight, so anything that then renders in a negative-UTC-offset
 * timezone rolls back a day (caught live -- "valid until" showed
 * December 30 for a December 31 input); noon UTC is far enough from
 * midnight in either direction that no real-world timezone can roll it
 * over. Explicit Asia/Manila on the formatter itself makes the actual
 * displayed date deterministic regardless of what timezone the server
 * (Vercel's functions run in UTC) happens to execute in -- otherwise
 * issuedAt (a real timestamp, not date-only) could shift near midnight.
 */
function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(`${d}T12:00:00Z`) : d;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" });
}

export async function generatePermitAssets(input: PermitPdfInput): Promise<{ pdf: Uint8Array; qrPng: Uint8Array }> {
  const qrPng = await QRCode.toBuffer(input.verifyUrl, { type: "png", margin: 1, width: 300, color: { dark: "#0C4DA2", light: "#FFFFFF" } });

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const qrImage = await pdfDoc.embedPng(qrPng);

  // --- Letterhead banner ---
  const bannerHeight = 118;
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - bannerHeight, width: PAGE_WIDTH, height: bannerHeight, color: NAVY });

  let y = PAGE_HEIGHT - 30;
  centerText(page, "Republic of the Philippines", y, font, 11, rgb(1, 1, 1));
  y -= 15;
  if (input.lgu.province) {
    centerText(page, `Province of ${input.lgu.province}`, y, font, 11, rgb(1, 1, 1));
    y -= 15;
  }
  centerText(page, input.lgu.displayName, y, font, 11, rgb(1, 1, 1));
  y -= 16;
  centerText(page, input.lgu.bploOfficeName.toUpperCase(), y, bold, 10, rgb(1, 1, 1));
  y -= 26;
  centerText(page, "BUSINESS PERMIT", y, bold, 20, rgb(1, 1, 1));

  // --- Permit number, prominent, right under the banner ---
  y = PAGE_HEIGHT - bannerHeight - 34;
  centerText(page, `Permit No. ${input.referenceNumber}`, y, bold, 14, NAVY);

  // --- Details table ---
  y -= 42;
  const rows: [string, string][] = [
    ["Business name", input.businessName],
    ["Owner / Representative", input.ownerName],
    ["Nature of business", input.natureOfBusiness ?? "—"],
    ["Business address", input.address || "—"],
    ["Application type", input.applicationType === "new" ? "New" : "Renewal"],
    ["Date issued", formatDate(input.issuedAt)],
    ["Valid until", formatDate(input.validUntil)],
  ];
  for (const [label, value] of rows) {
    page.drawText(label, { x: MARGIN, y, font: bold, size: 10.5, color: MUTED });
    page.drawText(value, { x: MARGIN + 170, y, font, size: 11, color: INK, maxWidth: PAGE_WIDTH - MARGIN - 170 - MARGIN });
    y -= 26;
  }

  // --- Body text ---
  y -= 14;
  const bodyLines = wrapText(
    `This is to certify that the business named above has been granted permission to operate within the ${input.lgu.displayName}, subject to existing local ordinances and national laws. This permit must be posted in a conspicuous place at the business premises and is valid only for the period stated above.`,
    font,
    10,
    PAGE_WIDTH - MARGIN * 2
  );
  for (const line of bodyLines) {
    page.drawText(line, { x: MARGIN, y, font, size: 10, color: INK });
    y -= 14;
  }

  // --- Signature line ---
  // "City Mayor" vs "Municipal Mayor" derived from the office name rather
  // than a separate stored field -- one word's worth of variance isn't
  // worth its own lgus column when bplo_office_name already says which.
  const mayorTitle = /\bcity\b/i.test(input.lgu.bploOfficeName) ? "City Mayor" : "Municipal Mayor";
  const sigY = 150;
  page.drawLine({ start: { x: PAGE_WIDTH - MARGIN - 200, y: sigY }, end: { x: PAGE_WIDTH - MARGIN, y: sigY }, thickness: 1, color: INK });
  page.drawText(mayorTitle, { x: PAGE_WIDTH - MARGIN - 200, y: sigY - 14, font: bold, size: 10, color: INK });

  // --- QR code + verification note ---
  const qrSize = 90;
  page.drawImage(qrImage, { x: MARGIN, y: sigY - qrSize + 30, width: qrSize, height: qrSize });
  page.drawText("Scan to verify", { x: MARGIN, y: sigY - qrSize + 14, font, size: 9, color: MUTED });

  // --- Footer ---
  page.drawText(
    `Generated electronically via MuniServe. Verify at: ${input.verifyUrl}`,
    { x: MARGIN, y: 40, font, size: 8, color: MUTED }
  );

  const pdfBytes = await pdfDoc.save();
  return { pdf: pdfBytes, qrPng };
}

function centerText(page: PDFPage, text: string, y: number, font: PDFFont, size: number, color: ReturnType<typeof rgb>) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (PAGE_WIDTH - width) / 2, y, font, size, color });
}

/** Naive word-wrap by measured width -- good enough for the one paragraph on this certificate. */
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
