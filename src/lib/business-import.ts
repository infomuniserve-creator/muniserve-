import { parseCsv, toCsv } from "@/lib/fee-rule-import";
import { normalizePhone } from "@/lib/phone";
import { BUSINESS_TAX_PAYMENT_OPTIONS, GENDER_OPTIONS, ORGANIZATION_TYPE_OPTIONS } from "@/lib/san-miguel-form-options";

/**
 * Self-service legacy business roster import (2026-08-18, project owner's
 * request) -- turns what was originally a one-time, developer-run SQL
 * script for San Miguel (`supabase/seed/legacy_business_import.sql`,
 * 1,177 rows from `BPLO_LBT_Backfill_v2.csv`) into a real Settings upload
 * any new LGU can do themselves, matching that same script's exact
 * column shape (business_name, barangay, nature_of_business,
 * lbt_category, legacy_license_no, legacy_owner_name, gross_sales,
 * is_legacy_unclaimed, is_active) plus the columns the original import
 * never had: phone, email, gender, business_tax_payment, and a purely
 * informational legacy_application_type note (2026-08-19 follow-up,
 * flagged by the project owner reviewing the actual template).
 *
 * `organization_type` is validated against the REAL applicant-form
 * values (`ORGANIZATION_TYPE_OPTIONS` -- "Sole Proprietorship",
 * "Partnership", etc.), not "individual"/"juridical" -- that pairing is
 * the fee engine's own internal CEDULA classification derived FROM
 * organization_type (`fee-engine.ts`: `organizationType.toLowerCase() ===
 * "sole proprietorship"`), not what's actually stored on the column. The
 * first version of this file got this wrong; caught while adding the
 * fields below, not by a separate report.
 *
 * Same preview-before-publish shape as fee-rule-import.ts -- this module
 * is parse-only, no I/O. The actual database writes (find-or-create an
 * owner, insert businesses, decide what's a duplicate) live in
 * settings/business-import-actions.ts, which re-parses the file
 * server-side rather than trusting a client's own preview state.
 */

export const BUSINESS_IMPORT_HEADERS = [
  "business_name",
  "legacy_license_no",
  "barangay",
  "address",
  "nature_of_business",
  "lbt_category",
  "organization_type",
  "tin",
  "legacy_owner_name",
  "owner_gender",
  "phone",
  "email",
  "business_tax_payment",
  "gross_sales",
  "legacy_application_type",
];

const ORG_TYPE_LOOKUP = new Map(ORGANIZATION_TYPE_OPTIONS.map((v) => [v.toLowerCase(), v]));
const GENDER_LOOKUP = new Map(GENDER_OPTIONS.map((v) => [v.toLowerCase(), v]));
const TAX_PAYMENT_LOOKUP = new Map(BUSINESS_TAX_PAYMENT_OPTIONS.map((v) => [v.toLowerCase(), v]));

export type ParsedBusinessRow = {
  businessName: string;
  legacyLicenseNo: string | null;
  barangay: string | null;
  address: string | null;
  natureOfBusiness: string | null;
  lbtCategory: string | null; // validated against the LGU's own active LBT schedule codes at publish time, not here -- this module doesn't know the LGU
  organizationType: (typeof ORGANIZATION_TYPE_OPTIONS)[number] | null;
  tin: string | null;
  legacyOwnerName: string | null;
  ownerGender: (typeof GENDER_OPTIONS)[number] | null; // only ever applied to a NEWLY created owner -- see business-import-actions.ts
  phone: string | null; // already normalized (09XXXXXXXXX), or null if blank/invalid
  email: string | null;
  businessTaxPayment: (typeof BUSINESS_TAX_PAYMENT_OPTIONS)[number] | null;
  grossSales: number | null;
  legacyApplicationType: string | null; // purely informational, shown in the Business Registry -- not the same concept as applications.application_type, see CLAUDE.md
  sourceRow: number;
};

export type BusinessImportResult = { ok: true; rows: ParsedBusinessRow[]; warnings: string[] } | { ok: false; errors: string[] };

function cell(idx: Map<string, number>, cells: string[], name: string): string {
  const i = idx.get(name);
  return i == null ? "" : (cells[i] ?? "").trim();
}
function headerIndexOf(header: string[]): Map<string, number> {
  const map = new Map<string, number>();
  header.forEach((h, i) => map.set(h.trim().toLowerCase(), i));
  return map;
}
function num(value: string): number | null {
  if (value === "") return null;
  const n = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export function buildBusinessImportTemplateCsv(): string {
  const rows: (string | number | null)[][] = [
    [
      "EXAMPLE -- CEZMIL'S AUTO AND ELECTRICAL SUPPLY (replace with your own businesses, one row each)",
      "7094956",
      "Camias",
      "",
      "Retailer",
      "retailer",
      "Sole Proprietorship",
      "",
      "MILAGROS KING BUENAVENTURA",
      "Female",
      "09171234567",
      "milagros@example.com",
      "Annual",
      3462287,
      "Renewal",
    ],
    [
      "EXAMPLE -- A business with no known phone yet (leave phone/email blank -- it imports as unclaimed, same as before)",
      "7095975",
      "Camias",
      "",
      "Retailer",
      "retailer",
      "Sole Proprietorship",
      "",
      "MARIA LOURDES V. SISON",
      "Female",
      "",
      "",
      "Quarterly",
      260696,
      "New",
    ],
  ];
  return toCsv(BUSINESS_IMPORT_HEADERS, rows);
}

/**
 * lbtCategory is checked against a real known set at PUBLISH time
 * (business-import-actions.ts), not here -- this module doesn't have
 * access to the LGU's own configured LBT schedules. organization_type,
 * owner_gender, and business_tax_payment ARE validated here, against
 * this app's own fixed applicant-form option lists (not LGU-specific).
 * An unrecognized value in any of these degrades to blank with a
 * warning rather than failing the row -- same "don't block the whole
 * import over one soft field" philosophy as every other optional column.
 */
export function parseBusinessImportCsv(text: string): BusinessImportResult {
  const grid = parseCsv(text);
  if (grid.length < 2) return { ok: false, errors: ["The file has no data rows -- only a header (or is empty)."] };
  const idx = headerIndexOf(grid[0]);
  const missing = BUSINESS_IMPORT_HEADERS.filter((h) => !idx.has(h));
  if (missing.length > 0) return { ok: false, errors: [`Missing required column(s): ${missing.join(", ")}. Download the template again if you're not sure of the exact column names.`] };

  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: ParsedBusinessRow[] = [];
  const seenLicenseNos = new Map<string, number>(); // license_no -> first row number, for in-file duplicate detection

  for (let r = 1; r < grid.length; r++) {
    const rowNum = r + 1;
    const cells = grid[r];
    const businessName = cell(idx, cells, "business_name");
    if (!businessName) {
      errors.push(`Row ${rowNum}: business_name is required.`);
      continue;
    }

    const legacyLicenseNoRaw = cell(idx, cells, "legacy_license_no");
    const legacyLicenseNo = legacyLicenseNoRaw || null;
    if (legacyLicenseNo) {
      const firstRow = seenLicenseNos.get(legacyLicenseNo);
      if (firstRow != null) {
        errors.push(`Row ${rowNum} ("${businessName}"): legacy_license_no "${legacyLicenseNo}" is already used on row ${firstRow} in this same file -- each business needs its own number.`);
        continue;
      }
      seenLicenseNos.set(legacyLicenseNo, rowNum);
    } else {
      warnings.push(`Row ${rowNum} ("${businessName}"): no legacy_license_no -- applicants won't be able to find this business by number lookup. It can still be claimed by phone at the counter, or given a number later in the Business Registry.`);
    }

    const phoneRaw = cell(idx, cells, "phone");
    let phone: string | null = null;
    if (phoneRaw) {
      phone = normalizePhone(phoneRaw);
      if (!phone) warnings.push(`Row ${rowNum} ("${businessName}"): phone "${phoneRaw}" doesn't look like a valid PH mobile number -- imported without a phone, as unclaimed.`);
    }

    const orgTypeRaw = cell(idx, cells, "organization_type");
    const organizationType = orgTypeRaw ? (ORG_TYPE_LOOKUP.get(orgTypeRaw.toLowerCase()) ?? null) : null;
    if (orgTypeRaw && !organizationType) warnings.push(`Row ${rowNum} ("${businessName}"): organization_type "${orgTypeRaw}" isn't one of ${ORGANIZATION_TYPE_OPTIONS.join(", ")} -- imported blank.`);

    const genderRaw = cell(idx, cells, "owner_gender");
    const ownerGender = genderRaw ? (GENDER_LOOKUP.get(genderRaw.toLowerCase()) ?? null) : null;
    if (genderRaw && !ownerGender) warnings.push(`Row ${rowNum} ("${businessName}"): owner_gender "${genderRaw}" isn't one of ${GENDER_OPTIONS.join(", ")} -- imported blank.`);
    if (genderRaw && !phone) warnings.push(`Row ${rowNum} ("${businessName}"): owner_gender was given but there's no phone, so there's no owner to attach it to -- ignored. Gender only applies when a business is claimed immediately.`);

    const taxPaymentRaw = cell(idx, cells, "business_tax_payment");
    const businessTaxPayment = taxPaymentRaw ? (TAX_PAYMENT_LOOKUP.get(taxPaymentRaw.toLowerCase()) ?? null) : null;
    if (taxPaymentRaw && !businessTaxPayment) warnings.push(`Row ${rowNum} ("${businessName}"): business_tax_payment "${taxPaymentRaw}" isn't one of ${BUSINESS_TAX_PAYMENT_OPTIONS.join(", ")} -- imported blank.`);

    const grossSalesRaw = cell(idx, cells, "gross_sales");
    const grossSales = grossSalesRaw ? num(grossSalesRaw) : null;
    if (grossSalesRaw && grossSales == null) warnings.push(`Row ${rowNum} ("${businessName}"): gross_sales "${grossSalesRaw}" isn't a number -- imported blank.`);

    rows.push({
      businessName,
      legacyLicenseNo,
      barangay: cell(idx, cells, "barangay") || null,
      address: cell(idx, cells, "address") || null,
      natureOfBusiness: cell(idx, cells, "nature_of_business") || null,
      lbtCategory: cell(idx, cells, "lbt_category").toLowerCase() || null,
      organizationType,
      tin: cell(idx, cells, "tin") || null,
      legacyOwnerName: cell(idx, cells, "legacy_owner_name") || null,
      ownerGender,
      phone,
      email: cell(idx, cells, "email") || null,
      businessTaxPayment,
      grossSales,
      legacyApplicationType: cell(idx, cells, "legacy_application_type") || null,
      sourceRow: rowNum,
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rows, warnings };
}

export function summarizeBusinessRow(row: ParsedBusinessRow): string {
  const claim = row.phone ? `claimed immediately (phone on file)` : "unclaimed -- self-claimable later";
  const license = row.legacyLicenseNo ? `License No. ${row.legacyLicenseNo}` : "no License No.";
  return `${row.businessName} (${license}) -- ${claim}`;
}
