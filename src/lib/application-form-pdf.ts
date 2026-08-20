import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { LguDisplay } from "@/lib/lgu";
import type { FieldKey } from "@/lib/application-form-logic";
import { wrapText } from "@/lib/pdf-doc-utils";

/**
 * Generates a PDF of exactly what an applicant (or BPLO, filing a walk-in)
 * submitted for one specific application -- a downloadable, non-editable
 * record for staff, separate from both the pre-signature certificate
 * (print-certificate.ts) and the signed permit (permit-pdf.ts), neither of
 * which shows the raw submitted field values.
 *
 * Field labels, section titles, and section order are copied directly from
 * reference/official-application-form/fields.json's real customFieldLabel
 * values and header text (one section header's source typo,
 * "INFORMATON", is corrected here -- this document doesn't claim to be a
 * pixel-exact facsimile of the source form the way print-certificate.ts's
 * own doc comment already establishes for that certificate, so there's no
 * reason to reproduce an obvious typo in MuniServe's own output).
 *
 * Data source: `applications.form_snapshot` (migration 0036), captured at
 * the moment of submission -- NOT the live `businesses` row, which is
 * mutable and gets overwritten by every later renewal. A snapshot-less
 * application (submitted before this column existed) falls back to the
 * business's current data with `snapshot.source === "reconstructed"`,
 * which renders a visible disclaimer banner instead of silently presenting
 * possibly-stale-relative-to-that-application data as if it were exact.
 *
 * Uploaded documents (Cedula, Gov't ID, etc.) are listed by type and
 * upload date, not re-embedded as pages -- they're already viewable via
 * the existing DocumentList/signed-URL pattern in the dashboard, and
 * merging heterogeneous PDF/JPEG/PNG uploads into one document reliably
 * is a materially bigger undertaking than what "download the submitted
 * form" was actually asking for.
 */

const PAGE_WIDTH = 612; // Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const NAVY = rgb(0x0c / 255, 0x4d / 255, 0xa2 / 255);
const INK = rgb(0.1, 0.1, 0.18);
const MUTED = rgb(0.42, 0.45, 0.5);
const WARN_BG = rgb(0.99, 0.95, 0.85);
const WARN_INK = rgb(0.55, 0.38, 0.05);
const ROW_H = 17;
const CONTENT_BOTTOM = 60;

export type ApplicationFormSnapshot = {
  /** "online" = applicant's own submission, "walkin" = BPLO filed it on their behalf, "reconstructed" = no snapshot was captured (pre-migration application) -- rebuilt from current business data, may not match what was originally submitted. */
  source: "online" | "walkin" | "reconstructed";
  fields: Partial<Record<FieldKey, unknown>>;
};

export type ApplicationFormPdfInput = {
  referenceNumber: string;
  applicationType: "new" | "renewal";
  applicationYear: number;
  submittedAt: Date;
  businessName: string;
  ownerName: string;
  ownerPhone: string | null;
  snapshot: ApplicationFormSnapshot;
  documents: { documentType: string; uploadedAt: string }[];
  declarationAcceptedAt: string | null;
  lgu: LguDisplay;
};

const MONEY_FIELDS = new Set<FieldKey>(["capitalInvestment", "grossSales", "monthlyRent"]);

const SECTIONS: { title: string; fields: { key: FieldKey; label: string }[] }[] = [
  {
    title: "BUSINESS INFORMATION AND REGISTRATION",
    fields: [
      { key: "businessTaxPayment", label: "Business Tax Payment" },
      { key: "registrationAuthority", label: "Registration Authority" },
      { key: "registrationNo", label: "DTI / SEC / CDA Registration No." },
      { key: "tin", label: "Tax Identification Number (TIN)" },
      { key: "taxType", label: "Tax Type" },
      { key: "natureOfBusiness", label: "Nature of Business" },
      { key: "organizationType", label: "Organization Type" },
      { key: "tradeName", label: "Trade Name or Franchise Name (if any)" },
      { key: "capitalInvestment", label: "Capital Investment" },
      { key: "grossSales", label: "Total Gross Sales" },
      { key: "billiardTableCount", label: "Number of Billiard Tables" },
      { key: "lodgerCount", label: "Number of Lodgers / Rooms" },
      { key: "landAreaHectares", label: "Land Area (Hectares)" },
      { key: "guardPostCount", label: "Number of Localities with Posted Guards" },
      { key: "warehouseFloorAreaSqm", label: "Floor Area (Square Meters)" },
      { key: "seatingCapacity", label: "Seating Capacity" },
      { key: "isAircon", label: "Air-Conditioned?" },
      { key: "isBranchOffice", label: "Is Branch Office?" },
      { key: "animalCount", label: "Number of Animals" },
    ],
  },
  {
    title: "MAIN OFFICE ADDRESS",
    fields: [
      { key: "unitStreet", label: "Unit No. | Appt | Street" },
      { key: "cityTown", label: "City | Town" },
      { key: "barangay", label: "Barangay" },
      { key: "province", label: "Province" },
      { key: "zipCode", label: "Zip Code" },
    ],
  },
  {
    title: "OWNER / REPRESENTATIVE INFO",
    fields: [
      { key: "firstName", label: "First Name" },
      { key: "lastName", label: "Last Name" },
      { key: "email", label: "Email" },
      { key: "gender", label: "Owner's Gender" },
    ],
  },
  {
    title: "BUSINESS OPERATION",
    fields: [
      { key: "businessActivity", label: "Business Activity" },
      { key: "deliveryVehicleCount", label: "No. of Delivery Vehicles (Van/Truck) if Any" },
      { key: "operationAddressSame", label: "Is Main Office Address Same as Business Operation Address?" },
      { key: "operationAddress", label: "Business Operation Address" },
      { key: "businessAreaSqm", label: "Business Area (in sq. meters)" },
      { key: "totalFloorAreaSqm", label: "Total Floor Area (in sq. meters)" },
      { key: "secondaryBusinessActivity", label: "Secondary Business Activity" },
      { key: "premisesOwnership", label: "Business Premises Ownership" },
      { key: "taxDeclarationNo", label: "Tax Declaration No. or Property Identification No." },
      { key: "monthlyRent", label: "Monthly Rent" },
      { key: "lessorName", label: "Lessor Name" },
      { key: "lessorContactNo", label: "Lessor Contact No." },
      { key: "lessorAddress", label: "Lessor Complete Address" },
      { key: "hasEmployees", label: "Do You Have Employees?" },
      { key: "maleEmployeeCount", label: "Total Male Employees" },
      { key: "femaleEmployeeCount", label: "Total Female Employees" },
      { key: "employeesResidingInLguCount", label: "Total Employees Residing in LGU" },
      { key: "hasBarangayClearance", label: "Do You Have a Barangay Clearance?" },
      { key: "hasTaxIncentives", label: "Do You Have Tax Incentives from Any Government Entity?" },
    ],
  },
];

function formatValue(key: FieldKey, value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value.length ? value.join(", ") : null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (MONEY_FIELDS.has(key)) {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n)) return `Php ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  }
  return String(value);
}

function formatDateTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
}

const LABEL_WIDTH = 195;
const VALUE_X = MARGIN + 210;
const LINE_GAP = 12;

class PageWriter {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  page!: PDFPage;
  y = 0;

  private constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
  }

  static async create(): Promise<PageWriter> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const w = new PageWriter(doc, font, bold);
    w.addPage();
    return w;
  }

  addPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  ensureSpace(height: number) {
    if (this.y - height < CONTENT_BOTTOM) this.addPage();
  }

  text(str: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number } = {}) {
    this.page.drawText(str, { x: opts.x ?? MARGIN, y: this.y, font: opts.font ?? this.font, size: opts.size ?? 10, color: opts.color ?? INK });
  }

  sectionHeader(title: string) {
    this.ensureSpace(34);
    this.y -= 6;
    this.page.drawRectangle({ x: MARGIN, y: this.y - 4, width: PAGE_WIDTH - MARGIN * 2, height: 20, color: rgb(0.94, 0.95, 0.98) });
    this.text(title, { font: this.bold, size: 10.5, color: NAVY, x: MARGIN + 8 });
    this.y -= 26;
  }

  row(label: string, value: string) {
    const valueWidth = PAGE_WIDTH - VALUE_X - MARGIN;
    const labelLines = wrapText(label, this.bold, 9.5, LABEL_WIDTH);
    const valueLines = wrapText(value, this.font, 10, valueWidth);
    const lineCount = Math.max(labelLines.length, valueLines.length);
    const height = lineCount * LINE_GAP + 5;
    this.ensureSpace(height);
    let ly = this.y;
    for (const line of labelLines) {
      this.page.drawText(line, { x: MARGIN, y: ly, font: this.bold, size: 9.5, color: MUTED });
      ly -= LINE_GAP;
    }
    let vy = this.y;
    for (const line of valueLines) {
      this.page.drawText(line, { x: VALUE_X, y: vy, font: this.font, size: 10, color: INK });
      vy -= LINE_GAP;
    }
    this.y -= height;
  }
}

export async function generateApplicationFormPdf(input: ApplicationFormPdfInput): Promise<Uint8Array> {
  const w = await PageWriter.create();

  // --- Letterhead ---
  const bannerHeight = 96;
  w.page.drawRectangle({ x: 0, y: PAGE_HEIGHT - bannerHeight, width: PAGE_WIDTH, height: bannerHeight, color: NAVY });
  let y = PAGE_HEIGHT - 26;
  const centered = (str: string, size: number, font: PDFFont) => {
    const width = font.widthOfTextAtSize(str, size);
    w.page.drawText(str, { x: (PAGE_WIDTH - width) / 2, y, font, size, color: rgb(1, 1, 1) });
  };
  centered("Republic of the Philippines", 10.5, w.font);
  y -= 14;
  if (input.lgu.province) {
    centered(`Province of ${input.lgu.province}`, 10.5, w.font);
    y -= 14;
  }
  centered(input.lgu.displayName, 10.5, w.font);
  y -= 24;
  centered("SUBMITTED APPLICATION FORM FOR BUSINESS PERMIT", 13, w.bold);
  w.y = PAGE_HEIGHT - bannerHeight - 30;

  // --- Reconstructed-data disclaimer ---
  if (input.snapshot.source === "reconstructed") {
    w.ensureSpace(40);
    w.page.drawRectangle({ x: MARGIN, y: w.y - 30, width: PAGE_WIDTH - MARGIN * 2, height: 34, color: WARN_BG });
    const lines = [
      "No submission snapshot exists for this application (filed before this feature existed).",
      "Fields below are reconstructed from this business's current records and may not exactly match what was originally submitted.",
    ];
    let ly = w.y - 12;
    for (const line of lines) {
      w.page.drawText(line, { x: MARGIN + 8, y: ly, font: w.font, size: 8.5, color: WARN_INK });
      ly -= 12;
    }
    w.y -= 46;
  }

  // --- Summary block ---
  w.row("Reference Number", input.referenceNumber);
  w.row("Application Type", input.applicationType === "new" ? "New" : "Renewal");
  w.row("Application Year", String(input.applicationYear));
  w.row("Business Name", input.businessName);
  w.row("Owner / Representative", input.ownerName);
  if (input.ownerPhone) w.row("Mobile Phone", input.ownerPhone);
  w.row("Submitted", formatDateTime(input.submittedAt));
  w.y -= 8;

  // --- Field sections ---
  for (const section of SECTIONS) {
    const rows = section.fields
      .map(({ key, label }) => ({ label, value: formatValue(key, input.snapshot.fields[key]) }))
      .filter((r): r is { label: string; value: string } => r.value !== null);
    if (rows.length === 0) continue;
    w.sectionHeader(section.title);
    for (const r of rows) w.row(r.label, r.value);
    w.y -= 8;
  }

  // --- Documents submitted ---
  w.sectionHeader("DOCUMENTS SUBMITTED");
  if (input.documents.length === 0) {
    w.text("No documents on file for this application.", { color: MUTED, size: 9.5 });
    w.y -= ROW_H;
  } else {
    for (const doc of input.documents) {
      w.row(doc.documentType, formatDateTime(doc.uploadedAt));
    }
  }
  w.y -= 8;

  // --- Declaration ---
  w.sectionHeader("DECLARATION");
  w.text(
    input.declarationAcceptedAt
      ? `The applicant declared the information above true and correct, and accepted the terms and conditions on ${formatDateTime(input.declarationAcceptedAt)}.`
      : "No declaration timestamp on file for this application.",
    { size: 9.5, color: INK }
  );
  w.y -= ROW_H;

  // --- Footer on every page ---
  const pageCount = w.doc.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    const page = w.doc.getPage(i);
    page.drawText(`Generated electronically via MuniServe on ${formatDateTime(new Date())}. Not editable.`, {
      x: MARGIN, y: 30, font: w.font, size: 7.5, color: MUTED,
    });
    page.drawText(`Page ${i + 1} of ${pageCount}`, {
      x: PAGE_WIDTH - MARGIN - 60, y: 30, font: w.font, size: 7.5, color: MUTED,
    });
  }

  return w.doc.save();
}
