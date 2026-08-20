import { rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Shared pdf-lib layout helpers -- extracted (2026-08-20 audit) from four
 * near-identical copies that had grown independently across permit-pdf.ts,
 * print-certificate.ts, order-of-payment-pdf.ts, and application-form-
 * pdf.ts. The duplication itself is what let a real bug ship: three of the
 * four generators drew a wrapped label/value row at a fixed row height
 * (e.g. `y -= 26`) with no regard for how many lines the value actually
 * wrapped to, so a long business name/address (a realistic, not
 * hypothetical, case for a real Philippine business) would visually
 * overlap the next row. application-form-pdf.ts's own `PageWriter.row()`
 * had already solved this correctly -- it just never got backported to
 * the other three, since there was no shared module for the fix to live
 * in. `drawLabelValueRow` below is that fix, generalized for all four
 * documents to share; the next PDF generator this project adds should use
 * it rather than reintroducing a fifth copy of any of this.
 */

/** Naive word-wrap by measured width. Never returns an empty array -- a blank input still occupies one (empty) line, so callers can safely compute `lines.length * lineGap` without special-casing "nothing to draw". */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
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
  return lines.length ? lines : [""];
}

export function centerText(page: PDFPage, pageWidth: number, text: string, y: number, font: PDFFont, size: number, color: ReturnType<typeof rgb>) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (pageWidth - width) / 2, y, font, size, color });
}

export function centerTextInRange(page: PDFPage, text: string, xStart: number, xEnd: number, y: number, font: PDFFont, size: number, color: ReturnType<typeof rgb>) {
  const width = font.widthOfTextAtSize(text, size);
  const rangeWidth = xEnd - xStart;
  page.drawText(text, { x: xStart + Math.max(0, (rangeWidth - width) / 2), y, font, size, color });
}

/**
 * Draws a wrapped label/value pair at fixed x-columns and returns the new
 * `y` to continue from -- the row's actual height is `max(labelLines,
 * valueLines) * lineGap`, computed from real wrapped line counts, never a
 * flat guessed number. This is the one calculation that was missing from
 * three of this project's four PDF generators (see the module doc comment
 * above) -- every caller should go through this rather than hand-rolling
 * the row-advance math again.
 */
export function drawLabelValueRow(
  page: PDFPage,
  y: number,
  opts: {
    label: string;
    value: string;
    labelX: number;
    valueX: number;
    valueMaxWidth: number;
    labelFont: PDFFont;
    labelSize: number;
    labelColor: ReturnType<typeof rgb>;
    valueFont: PDFFont;
    valueSize: number;
    valueColor: ReturnType<typeof rgb>;
    lineGap: number;
    /** Extra breathing room after the row, beyond the wrapped text height itself. */
    rowPadding?: number;
    labelMaxWidth?: number;
  }
): number {
  const labelLines = opts.labelMaxWidth != null ? wrapText(opts.label, opts.labelFont, opts.labelSize, opts.labelMaxWidth) : [opts.label];
  const valueLines = wrapText(opts.value, opts.valueFont, opts.valueSize, opts.valueMaxWidth);
  const lineCount = Math.max(labelLines.length, valueLines.length);
  const rowHeight = lineCount * opts.lineGap + (opts.rowPadding ?? 0);

  let ly = y;
  for (const line of labelLines) {
    page.drawText(line, { x: opts.labelX, y: ly, font: opts.labelFont, size: opts.labelSize, color: opts.labelColor });
    ly -= opts.lineGap;
  }
  let vy = y;
  for (const line of valueLines) {
    page.drawText(line, { x: opts.valueX, y: vy, font: opts.valueFont, size: opts.valueSize, color: opts.valueColor });
    vy -= opts.lineGap;
  }
  return y - rowHeight;
}

export function formatManilaDate(d: Date | string): string {
  // Date-only strings ("2026-12-31") parse as UTC midnight, which rolls
  // back a day once rendered in a negative-UTC-offset timezone -- noon UTC
  // is far enough from midnight in either direction that no real-world
  // offset can roll it over (caught live once already, permit-pdf.ts's own
  // "December 30 instead of December 31" bug). An explicit Asia/Manila on
  // the formatter itself makes the displayed date deterministic regardless
  // of what timezone the process happens to run in (Vercel's functions run
  // in UTC).
  const date = typeof d === "string" ? new Date(`${d}T12:00:00Z`) : d;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" });
}
