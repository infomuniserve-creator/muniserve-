/**
 * Business Tax & Mayor's Permit Fee Setup -- CSV import (2026-08-15).
 *
 * Replaces "a developer reads the LGU's real ordinance and hand-writes a
 * seed script" with "a developer (or the project owner, working from a
 * generated file) reads the LGU's real ordinance and fills out a CSV
 * template" -- the same careful reading step CLAUDE.md section 7b requires
 * stays exactly where it was; what changes is that the result is a
 * reviewable file uploaded through Settings instead of raw SQL run against
 * the database directly. See CLAUDE.md's onboarding-scalability discussion
 * (2026-08-15) for the full reasoning, including why this is deliberately
 * scoped to two computation shapes per fee type rather than every shape a
 * revenue code could contain.
 *
 * Two templates, matching the two fee_category values this covers:
 *   - LBT: always the graduated-bracket shape (computation_type = 'tiered').
 *     A pure flat-percentage schedule with no real brackets (e.g. San
 *     Ildefonso's Retailer schedule) is still expressible as two brackets
 *     with rate_basis = 'full_amount' -- no separate shape needed.
 *   - Mayor's Permit: 'flat' (a named business type, or the standard:new/
 *     standard:renewal fallback), 'per_unit' (a flat base plus a per-unit
 *     rate -- Security Agency, Billiard Hall, Carnival), or 'tier_matrix'
 *     (San Ildefonso's business-size-tier x category grid).
 *
 * Deliberately NOT covered by this importer (stays a migration/service-role
 * task, same as today, until real demand shows up): flat-rate-only per-unit
 * catalogs with no basis at all (San Ildefonso's per-vehicle-type public
 * utility fee), and a Mayor's Permit "standard:renewal" fallback that's
 * itself tiered by prior-year LBT (San Miguel's actual shape) -- importing
 * that one specific row still needs a migration; every other row imports
 * fine either way.
 */

export type FeeType = "lbt" | "mayors_permit";

export type ParsedBracket = {
  minAmount: number;
  maxAmount: number | null;
  baseFee: number;
  rate: number; // fraction, e.g. 0.02 for 2%
  rateBasis: "excess_over_min" | "full_amount";
};

export type ParsedFeeRule = {
  name: string;
  computationType: "tiered" | "flat" | "per_unit" | "tier_matrix";
  appliesTo: string;
  newBusinessRate: number | null; // LBT only, fraction
  flatAmount: number | null;
  perUnitRate: number | null;
  perUnitField: string | null;
  deliveryMode: "online" | "reference_only" | "external";
  brackets: ParsedBracket[]; // graduated brackets, or tier_matrix cells (tierLabel set instead of min/max)
  tierCells: { tierLabel: "cottage" | "small" | "medium" | "large"; amount: number }[];
  sourceRow: number; // 1-based row in the uploaded file, for error messages
};

export type ImportResult = { ok: true; rules: ParsedFeeRule[]; warnings: string[] } | { ok: false; errors: string[] };

const PER_UNIT_FIELDS = new Set(["billiard_table_count", "locality_count", "operating_days_beyond_ten"]);
const DELIVERY_MODES = new Set(["online", "reference_only", "external"]);

// ============================================================
// Minimal CSV parse/stringify -- no dependency, matching this project's
// established "pure-JS, no extra deps unless truly needed" approach
// (pdf-lib/qrcode are the only two runtime deps that exist for a reason).
// Handles quoted fields with embedded commas/quotes/newlines (RFC 4180),
// which is all a spreadsheet export ever actually produces.
// ============================================================

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function csvField(value: string): string {
  if (value === "") return "";
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [headers.map(csvField).join(",")];
  for (const row of rows) {
    lines.push(row.map((v) => csvField(v == null ? "" : String(v))).join(","));
  }
  return lines.join("\n");
}

// ============================================================
// Shared parse helpers
// ============================================================

function num(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function pct(value: string | undefined): number | null {
  const n = num(value);
  return n == null ? null : n / 100;
}

function col(headerIndex: Map<string, number>, cells: string[], name: string): string {
  const idx = headerIndex.get(name);
  return idx == null ? "" : (cells[idx] ?? "").trim();
}

function headerIndexOf(header: string[]): Map<string, number> {
  const map = new Map<string, number>();
  header.forEach((h, i) => map.set(h.trim().toLowerCase(), i));
  return map;
}

// ============================================================
// LBT template
// ============================================================

export const LBT_HEADERS = [
  "schedule_name",
  "category_code",
  "new_business_rate_percent",
  "delivery_mode",
  "bracket_min",
  "bracket_max",
  "base_fee",
  "rate_percent",
  "rate_basis",
];

export type ExportableLbtRule = {
  name: string;
  appliesTo: string;
  newBusinessRate: number | null;
  deliveryMode: string;
  brackets: { minAmount: number | null; maxAmount: number | null; baseFee: number; rate: number; rateBasis: string }[];
};

export function buildLbtTemplateCsv(existingRules: ExportableLbtRule[]): string {
  const rows: (string | number | null)[][] = [];
  const source = existingRules.length > 0 ? existingRules : EXAMPLE_LBT_RULES;
  for (const rule of source) {
    const brackets = rule.brackets.length > 0 ? rule.brackets : [{ minAmount: 0, maxAmount: null, baseFee: 0, rate: 0, rateBasis: "excess_over_min" }];
    brackets.forEach((b, i) => {
      rows.push([
        rule.name,
        rule.appliesTo,
        i === 0 ? (rule.newBusinessRate != null ? round2(rule.newBusinessRate * 100) : "") : "",
        i === 0 ? rule.deliveryMode : "",
        b.minAmount ?? 0,
        b.maxAmount ?? "",
        b.baseFee,
        round4(b.rate * 100),
        b.rateBasis,
      ]);
    });
  }
  return toCsv(LBT_HEADERS, rows);
}

const EXAMPLE_LBT_RULES: ExportableLbtRule[] = [
  {
    name: "EXAMPLE -- Schedule A -- Manufacturer, Assembler, Repackager, Processor (replace with your own LGU's rates)",
    appliesTo: "manufacturer",
    newBusinessRate: 0.01,
    deliveryMode: "online",
    brackets: [
      { minAmount: 0, maxAmount: 10000, baseFee: 165, rate: 0, rateBasis: "excess_over_min" },
      { minAmount: 10000, maxAmount: 15000, baseFee: 220, rate: 0, rateBasis: "excess_over_min" },
      { minAmount: 15000, maxAmount: null, baseFee: 302, rate: 0.00375, rateBasis: "full_amount" },
    ],
  },
];

export function parseLbtCsv(text: string): ImportResult {
  const grid = parseCsv(text);
  if (grid.length < 2) return { ok: false, errors: ["The file has no data rows -- only a header (or is empty)."] };
  const idx = headerIndexOf(grid[0]);
  const missing = LBT_HEADERS.filter((h) => !idx.has(h));
  if (missing.length > 0) return { ok: false, errors: [`Missing required column(s): ${missing.join(", ")}. Download the template again if you're not sure of the exact column names.`] };

  const errors: string[] = [];
  const warnings: string[] = [];
  const bySchedule = new Map<string, ParsedFeeRule>();
  const order: string[] = [];

  for (let r = 1; r < grid.length; r++) {
    const rowNum = r + 1; // 1-based, matching what a spreadsheet shows
    const cells = grid[r];
    // schedule_name/new_business_rate_percent/delivery_mode are only
    // actually needed on a category_code's FIRST row -- category_code is
    // the one thing every row must repeat, since it's what groups rows
    // into a schedule. (Bug fixed 2026-08-15: this used to require
    // schedule_name on every single row, contradicting both the
    // template this file itself generates -- which does leave those
    // three blank after the first row of each schedule -- and what
    // buildLbtTemplateCsv's own docs/the onboarding prompt already told
    // users was correct. A real upload built exactly as documented
    // failed on nearly every row until this was caught.)
    const scheduleName = col(idx, cells, "schedule_name");
    const categoryCode = col(idx, cells, "category_code").toLowerCase();
    if (!categoryCode) {
      errors.push(`Row ${rowNum}: category_code is required.`);
      continue;
    }
    const minAmount = num(col(idx, cells, "bracket_min"));
    const baseFee = num(col(idx, cells, "base_fee"));
    if (minAmount == null || baseFee == null) {
      errors.push(`Row ${rowNum} ("${categoryCode}"): bracket_min and base_fee must both be numbers.`);
      continue;
    }
    const rateBasisRaw = col(idx, cells, "rate_basis").toLowerCase() || "excess_over_min";
    if (rateBasisRaw !== "excess_over_min" && rateBasisRaw !== "full_amount") {
      errors.push(`Row ${rowNum} ("${categoryCode}"): rate_basis must be "excess_over_min" or "full_amount", got "${rateBasisRaw}".`);
      continue;
    }

    if (!bySchedule.has(categoryCode)) {
      if (!scheduleName) {
        errors.push(`Row ${rowNum}: schedule_name is required on the first row for category_code "${categoryCode}".`);
        continue;
      }
      const deliveryModeRaw = col(idx, cells, "delivery_mode").toLowerCase() || "online";
      if (!DELIVERY_MODES.has(deliveryModeRaw)) {
        errors.push(`Row ${rowNum} ("${scheduleName}"): delivery_mode must be online, reference_only, or external -- got "${deliveryModeRaw}".`);
        continue;
      }
      order.push(categoryCode);
      bySchedule.set(categoryCode, {
        name: scheduleName,
        computationType: "tiered",
        appliesTo: categoryCode,
        newBusinessRate: pct(col(idx, cells, "new_business_rate_percent")),
        flatAmount: null,
        perUnitRate: null,
        perUnitField: null,
        deliveryMode: deliveryModeRaw as ParsedFeeRule["deliveryMode"],
        brackets: [],
        tierCells: [],
        sourceRow: rowNum,
      });
    }

    const rule = bySchedule.get(categoryCode)!;
    // Only warn on an ACTUAL conflict -- a later row leaving schedule_name
    // blank (the documented, expected shape) is not a conflict.
    if (scheduleName && rule.name !== scheduleName) warnings.push(`Row ${rowNum}: category_code "${categoryCode}" was already used for "${rule.name}" -- this row's schedule_name ("${scheduleName}") is ignored, only the first one is kept.`);
    const maxAmountCell = col(idx, cells, "bracket_max");
    rule.brackets.push({
      minAmount,
      maxAmount: maxAmountCell === "" ? null : num(maxAmountCell),
      baseFee,
      rate: pct(col(idx, cells, "rate_percent")) ?? 0,
      rateBasis: rateBasisRaw as "excess_over_min" | "full_amount",
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  const rules = order.map((code) => bySchedule.get(code)!);
  for (const rule of rules) {
    rule.brackets.sort((a, b) => a.minAmount - b.minAmount);
    const openEnded = rule.brackets.filter((b) => b.maxAmount == null);
    if (openEnded.length !== 1) warnings.push(`Schedule "${rule.name}": expected exactly one open-ended top bracket (blank bracket_max) but found ${openEnded.length} -- double-check this schedule's rows.`);
  }
  const dupeNames = new Set<string>();
  const seenNames = new Set<string>();
  for (const rule of rules) {
    if (seenNames.has(rule.name)) dupeNames.add(rule.name);
    seenNames.add(rule.name);
  }
  if (dupeNames.size > 0) warnings.push(`These schedule names are used for more than one category_code: ${[...dupeNames].join(", ")}. That's allowed, but double-check it's intentional.`);

  return { ok: true, rules, warnings };
}

// ============================================================
// Mayor's Permit template
// ============================================================

export const MP_HEADERS = [
  "rule_name",
  "shape",
  "applies_to",
  "flat_amount",
  "per_unit_rate",
  "per_unit_field",
  "cottage_amount",
  "small_amount",
  "medium_amount",
  "large_amount",
  "delivery_mode",
];

export type ExportableMpRule = {
  name: string;
  computationType: string;
  appliesTo: string | null;
  flatAmount: number | null;
  perUnitRate: number | null;
  perUnitField: string | null;
  deliveryMode: string;
  tierCells: { tierLabel: string; amount: number }[];
};

function shapeFor(rule: ExportableMpRule): string {
  if (rule.computationType === "tier_matrix") return "tier_matrix";
  if (rule.computationType === "per_unit") return "per_unit";
  if (rule.appliesTo === "standard:new") return "standard_new";
  if (rule.appliesTo === "standard:renewal") return "standard_renewal";
  return "flat";
}

export function buildMayorsPermitTemplateCsv(existingRules: ExportableMpRule[]): string {
  const rows: (string | number | null)[][] = [];
  const source = existingRules.length > 0 ? existingRules : EXAMPLE_MP_RULES;
  for (const rule of source) {
    const shape = shapeFor(rule);
    const tier = (label: string) => rule.tierCells.find((t) => t.tierLabel === label)?.amount ?? "";
    rows.push([
      rule.name,
      shape,
      shape === "tier_matrix" || shape === "flat" || shape === "per_unit" ? (rule.appliesTo ?? "") : "",
      rule.flatAmount ?? "",
      rule.perUnitRate ?? "",
      rule.perUnitField ?? "",
      tier("cottage"),
      tier("small"),
      tier("medium"),
      tier("large"),
      rule.deliveryMode,
    ]);
  }
  return toCsv(MP_HEADERS, rows);
}

const EXAMPLE_MP_RULES: ExportableMpRule[] = [
  { name: "EXAMPLE -- Standard, New Business (replace with your own LGU's rates)", computationType: "flat", appliesTo: "standard:new", flatAmount: 500, perUnitRate: null, perUnitField: null, deliveryMode: "online", tierCells: [] },
  { name: "EXAMPLE -- Security Agency", computationType: "per_unit", appliesTo: "security agency", flatAmount: 300, perUnitRate: 50, perUnitField: "locality_count", deliveryMode: "online", tierCells: [] },
  {
    name: "EXAMPLE -- On Manufacturers / Importers / Producers (tier_matrix, replace with your own LGU's categories)",
    computationType: "tier_matrix",
    appliesTo: "tier_matrix_default",
    flatAmount: null,
    perUnitRate: null,
    perUnitField: null,
    deliveryMode: "online",
    tierCells: [
      { tierLabel: "cottage", amount: 500 },
      { tierLabel: "small", amount: 1000 },
      { tierLabel: "medium", amount: 1500 },
      { tierLabel: "large", amount: 3000 },
    ],
  },
];

export function parseMayorsPermitCsv(text: string): ImportResult {
  const grid = parseCsv(text);
  if (grid.length < 2) return { ok: false, errors: ["The file has no data rows -- only a header (or is empty)."] };
  const idx = headerIndexOf(grid[0]);
  const missing = MP_HEADERS.filter((h) => !idx.has(h));
  if (missing.length > 0) return { ok: false, errors: [`Missing required column(s): ${missing.join(", ")}. Download the template again if you're not sure of the exact column names.`] };

  const errors: string[] = [];
  const warnings: string[] = [];
  const rules: ParsedFeeRule[] = [];
  const seenAppliesTo = new Map<string, number>();

  for (let r = 1; r < grid.length; r++) {
    const rowNum = r + 1;
    const cells = grid[r];
    const name = col(idx, cells, "rule_name");
    const shape = col(idx, cells, "shape").toLowerCase();
    if (!name) {
      errors.push(`Row ${rowNum}: rule_name is required.`);
      continue;
    }
    const deliveryModeRaw = col(idx, cells, "delivery_mode").toLowerCase() || "online";
    if (!DELIVERY_MODES.has(deliveryModeRaw)) {
      errors.push(`Row ${rowNum} ("${name}"): delivery_mode must be online, reference_only, or external -- got "${deliveryModeRaw}".`);
      continue;
    }

    if (shape === "flat" || shape === "standard_new" || shape === "standard_renewal") {
      const appliesTo = shape === "standard_new" ? "standard:new" : shape === "standard_renewal" ? "standard:renewal" : col(idx, cells, "applies_to").toLowerCase();
      if (!appliesTo) {
        errors.push(`Row ${rowNum} ("${name}"): applies_to is required for shape "flat".`);
        continue;
      }
      const flatAmount = num(col(idx, cells, "flat_amount"));
      if (flatAmount == null) {
        errors.push(`Row ${rowNum} ("${name}"): flat_amount must be a number for shape "${shape}".`);
        continue;
      }
      const count = (seenAppliesTo.get(appliesTo) ?? 0) + 1;
      seenAppliesTo.set(appliesTo, count);
      rules.push({
        name,
        computationType: "flat",
        appliesTo,
        newBusinessRate: null,
        flatAmount,
        perUnitRate: null,
        perUnitField: null,
        deliveryMode: deliveryModeRaw as ParsedFeeRule["deliveryMode"],
        brackets: [],
        tierCells: [],
        sourceRow: rowNum,
      });
    } else if (shape === "per_unit") {
      const appliesTo = col(idx, cells, "applies_to").toLowerCase();
      const flatAmount = num(col(idx, cells, "flat_amount"));
      const perUnitRate = num(col(idx, cells, "per_unit_rate"));
      const perUnitField = col(idx, cells, "per_unit_field").toLowerCase();
      if (!appliesTo || flatAmount == null || perUnitRate == null) {
        errors.push(`Row ${rowNum} ("${name}"): shape "per_unit" needs applies_to, flat_amount, and per_unit_rate.`);
        continue;
      }
      if (!PER_UNIT_FIELDS.has(perUnitField)) {
        errors.push(`Row ${rowNum} ("${name}"): per_unit_field must be one of ${[...PER_UNIT_FIELDS].join(", ")} -- got "${perUnitField}".`);
        continue;
      }
      const count = (seenAppliesTo.get(appliesTo) ?? 0) + 1;
      seenAppliesTo.set(appliesTo, count);
      rules.push({
        name,
        computationType: "per_unit",
        appliesTo,
        newBusinessRate: null,
        flatAmount,
        perUnitRate,
        perUnitField,
        deliveryMode: deliveryModeRaw as ParsedFeeRule["deliveryMode"],
        brackets: [],
        tierCells: [],
        sourceRow: rowNum,
      });
    } else if (shape === "tier_matrix") {
      const appliesTo = col(idx, cells, "applies_to").toLowerCase();
      if (!appliesTo) {
        errors.push(`Row ${rowNum} ("${name}"): applies_to is required for shape "tier_matrix" (use "tier_matrix_default" for the catch-all category).`);
        continue;
      }
      const tierCells: ParsedFeeRule["tierCells"] = [];
      for (const [label, header] of [
        ["cottage", "cottage_amount"],
        ["small", "small_amount"],
        ["medium", "medium_amount"],
        ["large", "large_amount"],
      ] as const) {
        const amount = num(col(idx, cells, header));
        if (amount != null) tierCells.push({ tierLabel: label, amount });
      }
      if (tierCells.length === 0) {
        errors.push(`Row ${rowNum} ("${name}"): shape "tier_matrix" needs at least one of cottage_amount/small_amount/medium_amount/large_amount filled in.`);
        continue;
      }
      const count = (seenAppliesTo.get(appliesTo) ?? 0) + 1;
      seenAppliesTo.set(appliesTo, count);
      rules.push({
        name,
        computationType: "tier_matrix",
        appliesTo,
        newBusinessRate: null,
        flatAmount: null,
        perUnitRate: null,
        perUnitField: null,
        deliveryMode: deliveryModeRaw as ParsedFeeRule["deliveryMode"],
        brackets: [],
        tierCells,
        sourceRow: rowNum,
      });
    } else {
      errors.push(`Row ${rowNum} ("${name}"): shape must be flat, per_unit, tier_matrix, standard_new, or standard_renewal -- got "${shape || "(blank)"}".`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  for (const [appliesTo, count] of seenAppliesTo) {
    if (count > 1) warnings.push(`applies_to "${appliesTo}" is used on ${count} rows -- only the first will ever be matched by the calculator, the rest are dead rows.`);
  }
  const isTierMatrix = rules.some((r) => r.computationType === "tier_matrix");
  const isCatalog = rules.some((r) => r.computationType !== "tier_matrix");
  if (isTierMatrix && isCatalog) {
    errors.push(
      "This file mixes tier_matrix rows with flat/per_unit/standard rows. An LGU's Mayor's Permit Fee must use one shape or the other, not both -- remove one set of rows and re-upload."
    );
    return { ok: false, errors };
  }

  return { ok: true, rules, warnings };
}

// ============================================================
// Human-readable preview -- shown to BPLO before publishing, so a format
// mistake or an obviously wrong number is visible before it goes live.
// ============================================================

const PESO = (n: number) => `₱${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function summarizeRule(rule: ParsedFeeRule): string {
  if (rule.computationType === "tiered") {
    const bracketCount = rule.brackets.length;
    const newBiz = rule.newBusinessRate != null ? `, new business = ${round2(rule.newBusinessRate * 100)}% of capital investment` : "";
    const first = rule.brackets[0];
    const last = rule.brackets[rule.brackets.length - 1];
    const range = first && last ? `${PESO(first.minAmount)} up to ${last.maxAmount != null ? PESO(last.maxAmount) : "no limit"}` : "no brackets";
    return `${rule.name} (code "${rule.appliesTo}") -- ${bracketCount} bracket${bracketCount === 1 ? "" : "s"} covering ${range}${newBiz}`;
  }
  if (rule.computationType === "flat") {
    return `${rule.name} (applies_to "${rule.appliesTo}") -- flat ${PESO(rule.flatAmount ?? 0)}`;
  }
  if (rule.computationType === "per_unit") {
    return `${rule.name} (applies_to "${rule.appliesTo}") -- ${PESO(rule.flatAmount ?? 0)} base + ${PESO(rule.perUnitRate ?? 0)} per ${(rule.perUnitField ?? "").replace(/_/g, " ")}`;
  }
  if (rule.computationType === "tier_matrix") {
    const cells = rule.tierCells.map((t) => `${t.tierLabel}=${PESO(t.amount)}`).join(", ");
    return `${rule.name} (category "${rule.appliesTo}") -- ${cells}`;
  }
  return rule.name;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}
