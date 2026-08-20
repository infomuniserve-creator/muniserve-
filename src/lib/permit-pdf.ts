import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";
import type { LguDisplay } from "@/lib/lgu";
import { centerText, drawLabelValueRow, formatManilaDate, wrapText } from "@/lib/pdf-doc-utils";

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

const formatDate = formatManilaDate;

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
  centerText(page, PAGE_WIDTH, "Republic of the Philippines", y, font, 11, rgb(1, 1, 1));
  y -= 15;
  if (input.lgu.province) {
    centerText(page, PAGE_WIDTH, `Province of ${input.lgu.province}`, y, font, 11, rgb(1, 1, 1));
    y -= 15;
  }
  centerText(page, PAGE_WIDTH, input.lgu.displayName, y, font, 11, rgb(1, 1, 1));
  y -= 16;
  centerText(page, PAGE_WIDTH, input.lgu.bploOfficeName.toUpperCase(), y, bold, 10, rgb(1, 1, 1));
  y -= 26;
  centerText(page, PAGE_WIDTH, "BUSINESS PERMIT", y, bold, 20, rgb(1, 1, 1));

  // --- Permit number, prominent, right under the banner ---
  y = PAGE_HEIGHT - bannerHeight - 34;
  centerText(page, PAGE_WIDTH, `Permit No. ${input.referenceNumber}`, y, bold, 14, NAVY);

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
    y = drawLabelValueRow(page, y, {
      label, value,
      labelX: MARGIN, valueX: MARGIN + 170, valueMaxWidth: PAGE_WIDTH - MARGIN - 170 - MARGIN,
      labelFont: bold, labelSize: 10.5, labelColor: MUTED,
      valueFont: font, valueSize: 11, valueColor: INK,
      lineGap: 14, rowPadding: 12,
    });
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
