/**
 * Field-visibility engine for the applicant form, translated from
 * reference/official-application-form/conditional_logic.json -- the real
 * form's own 37 show/hide rules, extracted from its live config. Used by
 * both the client (src/app/apply/page.tsx, to show/hide fields as the
 * applicant types) and the server (submit-application/route.ts, to decide
 * what's actually required) so the two can't drift apart.
 *
 * Design note on defaults: rather than literally replaying the source
 * form's own rule-combination semantics for every rule (one rule in the
 * source -- a 16-condition "hide the nature-of-business cluster unless one
 * of these 16 specific values is selected" -- is genuinely ambiguous: its
 * exported combinator ("or" over 16 isNotEqualTo conditions) would, read
 * literally, fire for every possible value including the ones it's
 * supposed to leave alone, which can't be what actually happens in
 * production), every field that is EVER the target of an explicit "show"
 * outcome in the source rules defaults to hidden here; every other field
 * defaults to visible. That single principle reproduces the correct
 * observable behavior for all 37 rules without needing to resolve that
 * ambiguity -- see DEFAULT_HIDDEN below, and the dropped rule is called out
 * where it would have been.
 *
 * Two more source anomalies preserved/noted rather than "fixed":
 *  - Several rules gate `govIdDoc`, `dtiSecCdaDoc`, `leaseContractDoc`, and
 *    `vicinityMapDoc` on `hasTaxIncentives` having been answered at all,
 *    even though nothing about those documents is conceptually related to
 *    tax incentives. That's what the real form does (see the rule with the
 *    comment "hasTaxIncentives gate" below) -- kept faithfully.
 *  - Three source rules reference a field key `do_you_have_a_cedula?` that
 *    does not correspond to any of the real form's 68 actual fields (CEDULA
 *    is only ever captured as an unconditional required document upload,
 *    `cedulaDoc`). Those references are dropped as a dangling/orphaned rule
 *    reference in the source form's own config, not implemented here.
 */

export type FieldKey =
  // Business Info & Registration
  | "applicationType" | "businessTaxPayment" | "registrationAuthority" | "registrationNo" | "tin" | "taxType"
  | "businessName" | "natureOfBusiness" | "organizationType" | "tradeName"
  | "capitalInvestment" | "grossSales" | "swornStatementDoc"
  // Main Office Address
  | "unitStreet" | "cityTown" | "barangay" | "province" | "zipCode"
  // Owner / Representative Info
  | "firstName" | "lastName" | "email" | "phone" | "gender"
  // Business Operation
  | "businessActivity" | "deliveryVehicleCount" | "operationAddressSame" | "operationAddress"
  | "businessAreaSqm" | "totalFloorAreaSqm" | "secondaryBusinessActivity"
  | "premisesOwnership" | "taxDeclarationNo" | "monthlyRent" | "lessorName" | "lessorContactNo" | "lessorAddress" | "leaseContractDoc"
  | "hasEmployees" | "maleEmployeeCount" | "femaleEmployeeCount" | "employeesResidingInLguCount"
  | "cedulaDoc" | "hasBarangayClearance" | "barangayClearanceDoc" | "hasTaxIncentives" | "taxIncentivesDoc"
  // Nature-of-business-conditional cluster (9 groups)
  | "billiardTableCount" | "lodgerCount" | "landAreaHectares" | "guardPostCount" | "warehouseFloorAreaSqm"
  | "seatingCapacity" | "isAircon" | "isBranchOffice" | "animalCount"
  // Documents to Submit
  | "govIdDoc" | "dtiSecCdaDoc" | "vicinityMapDoc" | "signatureDoc"
  // Our own addition -- not in the source form, made mandatory regardless (see README)
  | "declarationAccepted";

type Condition = { field: FieldKey; op: "isEqualTo" | "isNotEqualTo" | "isEmpty"; value?: string };
type Rule = { combine: "any" | "all"; conditions: Condition[]; show: boolean; fields: FieldKey[] };

/** Fields that are only ever revealed by an explicit "show" rule below -- see the design note above. */
const DEFAULT_HIDDEN = new Set<FieldKey>([
  "capitalInvestment", "grossSales",
  "operationAddress",
  "taxDeclarationNo", "monthlyRent", "lessorName", "lessorContactNo", "lessorAddress", "leaseContractDoc",
  "maleEmployeeCount", "femaleEmployeeCount", "employeesResidingInLguCount",
  "barangayClearanceDoc", "taxIncentivesDoc",
  "billiardTableCount", "lodgerCount", "landAreaHectares", "guardPostCount", "warehouseFloorAreaSqm",
  "seatingCapacity", "isAircon", "isBranchOffice", "animalCount",
]);

/**
 * Fields required per fields.json whenever they're visible.
 * `declarationAccepted` is our own addition (source marks its T&C field
 * `required: false`; this build requires it anyway -- see plan/README).
 * `taxDeclarationNo` and `barangay` are deliberately absent even though
 * they're shown fields -- the source form itself marks both
 * `required: false` (an odd choice for barangay specifically, called out
 * in reference/official-application-form/README.md, but faithfully kept).
 * `swornStatementDoc` is the reverse deviation (2026-08-22, project
 * owner's own direct request) -- the source field is itself marked
 * `active: false, required: true`, but BPLO's own real-world call is that
 * a renewal applicant shouldn't be blocked over this one. Stays visible
 * (see the RULES below -- shown for Renewal once grossSales is filled),
 * just no longer required.
 */
export const REQUIRED_FIELDS = new Set<FieldKey>([
  "businessTaxPayment", "registrationAuthority", "registrationNo", "tin", "taxType", "businessName", "natureOfBusiness", "organizationType",
  "capitalInvestment", "grossSales",
  "unitStreet", "cityTown", "province", "zipCode",
  "firstName", "lastName", "email", "phone",
  "businessActivity", "operationAddressSame", "operationAddress", "businessAreaSqm", "totalFloorAreaSqm",
  "premisesOwnership", "monthlyRent", "lessorName", "lessorContactNo", "lessorAddress",
  "hasEmployees", "maleEmployeeCount", "femaleEmployeeCount", "employeesResidingInLguCount",
  "cedulaDoc", "hasBarangayClearance", "hasTaxIncentives", "taxIncentivesDoc",
  "billiardTableCount", "lodgerCount", "landAreaHectares", "guardPostCount", "warehouseFloorAreaSqm",
  "seatingCapacity", "isAircon", "isBranchOffice", "animalCount",
  "govIdDoc", "dtiSecCdaDoc", "vicinityMapDoc",
  "declarationAccepted",
]);

/**
 * Translated 1:1 from reference/official-application-form/conditional_logic.json,
 * in the same order they appear there (order matters -- later rules win over
 * earlier ones for the same field, matching the source's own top-to-bottom
 * evaluation). The one dropped rule (the ambiguous 16-condition nature-of-
 * business catch-all) is replaced by DEFAULT_HIDDEN above.
 */
export const RULES: Rule[] = [
  { combine: "all", conditions: [{ field: "applicationType", op: "isEmpty" }], show: false, fields: ["capitalInvestment", "grossSales", "swornStatementDoc"] },
  { combine: "all", conditions: [{ field: "applicationType", op: "isEqualTo", value: "New" }], show: false, fields: ["grossSales", "swornStatementDoc"] },
  { combine: "all", conditions: [{ field: "applicationType", op: "isEqualTo", value: "New" }], show: true, fields: ["capitalInvestment"] },
  { combine: "all", conditions: [{ field: "applicationType", op: "isEqualTo", value: "Renewal" }], show: false, fields: ["capitalInvestment"] },
  { combine: "all", conditions: [{ field: "applicationType", op: "isEqualTo", value: "Renewal" }], show: true, fields: ["grossSales"] },
  { combine: "all", conditions: [{ field: "grossSales", op: "isEmpty" }], show: false, fields: ["swornStatementDoc"] },

  { combine: "all", conditions: [{ field: "operationAddressSame", op: "isEmpty" }], show: false, fields: ["operationAddress"] },
  { combine: "all", conditions: [{ field: "operationAddressSame", op: "isEqualTo", value: "The Same as Main Office Address" }], show: false, fields: ["operationAddress"] },
  { combine: "all", conditions: [{ field: "operationAddressSame", op: "isEqualTo", value: "Business Operation is in Different Address" }], show: true, fields: ["operationAddress"] },

  { combine: "all", conditions: [{ field: "premisesOwnership", op: "isEmpty" }], show: false, fields: ["taxDeclarationNo", "monthlyRent", "lessorName", "lessorContactNo", "lessorAddress", "leaseContractDoc"] },
  { combine: "all", conditions: [{ field: "premisesOwnership", op: "isEqualTo", value: "Owned" }], show: true, fields: ["taxDeclarationNo"] },
  { combine: "any", conditions: [{ field: "premisesOwnership", op: "isEqualTo", value: "Rented" }, { field: "premisesOwnership", op: "isEqualTo", value: "Other" }], show: true, fields: ["monthlyRent", "lessorName", "lessorContactNo", "lessorAddress", "leaseContractDoc"] },

  { combine: "all", conditions: [{ field: "applicationType", op: "isEqualTo", value: "Renewal" }], show: false, fields: ["vicinityMapDoc"] },

  { combine: "all", conditions: [{ field: "hasEmployees", op: "isEmpty" }], show: false, fields: ["maleEmployeeCount", "femaleEmployeeCount", "employeesResidingInLguCount"] },
  { combine: "all", conditions: [{ field: "hasEmployees", op: "isEqualTo", value: "Yes" }], show: true, fields: ["maleEmployeeCount", "femaleEmployeeCount", "employeesResidingInLguCount"] },
  { combine: "all", conditions: [{ field: "hasEmployees", op: "isEqualTo", value: "No" }], show: false, fields: ["maleEmployeeCount", "femaleEmployeeCount", "employeesResidingInLguCount"] },

  { combine: "all", conditions: [{ field: "hasBarangayClearance", op: "isEmpty" }], show: false, fields: ["barangayClearanceDoc"] },
  { combine: "all", conditions: [{ field: "hasBarangayClearance", op: "isEqualTo", value: "Yes" }], show: true, fields: ["barangayClearanceDoc"] },

  // Cascading progressive disclosure: each of these upstream questions stays
  // hidden until the question before it is answered. (The source's third
  // target in each of these three rules, `do_you_have_a_cedula?`, doesn't
  // match any real field -- dropped, see file header.)
  { combine: "all", conditions: [{ field: "operationAddressSame", op: "isEmpty" }], show: false, fields: ["premisesOwnership", "hasEmployees", "hasTaxIncentives", "hasBarangayClearance"] },
  { combine: "all", conditions: [{ field: "premisesOwnership", op: "isEmpty" }], show: false, fields: ["hasEmployees", "hasBarangayClearance", "hasTaxIncentives"] },
  { combine: "all", conditions: [{ field: "hasEmployees", op: "isEmpty" }], show: false, fields: ["hasBarangayClearance", "hasTaxIncentives"] },

  { combine: "all", conditions: [{ field: "hasTaxIncentives", op: "isEmpty" }], show: false, fields: ["taxIncentivesDoc"] },
  { combine: "all", conditions: [{ field: "hasTaxIncentives", op: "isEqualTo", value: "Yes" }], show: true, fields: ["taxIncentivesDoc"] },
  { combine: "all", conditions: [{ field: "hasTaxIncentives", op: "isEqualTo", value: "No" }], show: false, fields: ["taxIncentivesDoc"] },

  { combine: "all", conditions: [{ field: "hasBarangayClearance", op: "isEqualTo", value: "No, generate my Brgy. clearance" }], show: false, fields: ["barangayClearanceDoc"] },

  // hasTaxIncentives gate (source anomaly, preserved -- see file header)
  { combine: "all", conditions: [{ field: "hasTaxIncentives", op: "isEmpty" }], show: false, fields: ["govIdDoc", "dtiSecCdaDoc", "leaseContractDoc", "vicinityMapDoc"] },

  { combine: "all", conditions: [{ field: "premisesOwnership", op: "isEqualTo", value: "Owned" }], show: false, fields: ["leaseContractDoc"] },

  { combine: "all", conditions: [{ field: "natureOfBusiness", op: "isEmpty" }], show: false, fields: ["billiardTableCount", "lodgerCount", "landAreaHectares", "guardPostCount", "warehouseFloorAreaSqm", "seatingCapacity", "isAircon", "isBranchOffice", "animalCount"] },
  { combine: "all", conditions: [{ field: "natureOfBusiness", op: "isEqualTo", value: "Billiard Hall" }], show: true, fields: ["billiardTableCount"] },
  { combine: "any", conditions: [
      { field: "natureOfBusiness", op: "isEqualTo", value: "Inn/Lodge" },
      { field: "natureOfBusiness", op: "isEqualTo", value: "Dormitory/Bedspace" },
      { field: "natureOfBusiness", op: "isEqualTo", value: "Transient House" },
      { field: "natureOfBusiness", op: "isEqualTo", value: "Boarding House" },
      { field: "natureOfBusiness", op: "isEqualTo", value: "Pension House" },
      { field: "natureOfBusiness", op: "isEqualTo", value: "Lodging House" },
    ], show: true, fields: ["lodgerCount"] },
  { combine: "any", conditions: [
      { field: "natureOfBusiness", op: "isEqualTo", value: "Real Estate Brokerage" },
      { field: "natureOfBusiness", op: "isEqualTo", value: "Property Developer/Subdivision" },
    ], show: true, fields: ["landAreaHectares"] },
  { combine: "all", conditions: [{ field: "natureOfBusiness", op: "isEqualTo", value: "Security Agency" }], show: true, fields: ["guardPostCount"] },
  { combine: "any", conditions: [
      { field: "natureOfBusiness", op: "isEqualTo", value: "Warehouse/Storage Facility" },
      { field: "natureOfBusiness", op: "isEqualTo", value: "Cold Storage" },
    ], show: true, fields: ["warehouseFloorAreaSqm"] },
  { combine: "all", conditions: [{ field: "natureOfBusiness", op: "isEqualTo", value: "Cinema/Movie Theater" }], show: true, fields: ["isAircon", "seatingCapacity"] },
  { combine: "any", conditions: [
      { field: "natureOfBusiness", op: "isEqualTo", value: "Rural Bank" },
      { field: "natureOfBusiness", op: "isEqualTo", value: "Commercial Bank" },
      { field: "natureOfBusiness", op: "isEqualTo", value: "Savings Bank" },
      { field: "natureOfBusiness", op: "isEqualTo", value: "Bank Branch" },
      { field: "natureOfBusiness", op: "isEqualTo", value: "Finance Company" },
      { field: "natureOfBusiness", op: "isEqualTo", value: "Finance & Investment Company" },
    ], show: true, fields: ["isBranchOffice"] },
  { combine: "any", conditions: [
      { field: "natureOfBusiness", op: "isEqualTo", value: "Piggery/Hog Raising" },
      { field: "natureOfBusiness", op: "isEqualTo", value: "Poultry Farm" },
      { field: "natureOfBusiness", op: "isEqualTo", value: "Chicken Farm" },
    ], show: true, fields: ["animalCount"] },
];

function conditionHolds(condition: Condition, values: Partial<Record<FieldKey, unknown>>): boolean {
  const raw = values[condition.field];
  const asString = raw == null ? "" : String(raw).trim();
  if (condition.op === "isEmpty") return asString === "";
  if (condition.op === "isEqualTo") return asString === condition.value;
  return asString !== condition.value; // isNotEqualTo
}

function ruleMatches(rule: Rule, values: Partial<Record<FieldKey, unknown>>): boolean {
  return rule.combine === "any"
    ? rule.conditions.some((c) => conditionHolds(c, values))
    : rule.conditions.every((c) => conditionHolds(c, values));
}

/** All field keys mentioned anywhere in RULES or DEFAULT_HIDDEN -- used to seed the baseline before applying rules. */
const RULE_TOUCHED_FIELDS: FieldKey[] = Array.from(
  new Set(RULES.flatMap((r) => [...r.conditions.map((c) => c.field), ...r.fields]).concat([...DEFAULT_HIDDEN]))
);

/**
 * Recomputes which fields should be visible given the current form values.
 * Call fresh on every value change -- rules are stateless and order-applied
 * top to bottom, last match wins per field (matches the source form).
 */
export function computeVisibleFields(values: Partial<Record<FieldKey, unknown>>): Set<FieldKey> {
  const visible = new Map<FieldKey, boolean>();
  for (const key of RULE_TOUCHED_FIELDS) visible.set(key, !DEFAULT_HIDDEN.has(key));
  for (const rule of RULES) {
    if (ruleMatches(rule, values)) {
      for (const field of rule.fields) visible.set(field, rule.show);
    }
  }
  return new Set([...visible.entries()].filter(([, v]) => v).map(([k]) => k));
}

/** A field not touched by any rule is always visible; otherwise defer to computeVisibleFields. */
export function isFieldVisible(field: FieldKey, values: Partial<Record<FieldKey, unknown>>): boolean {
  if (!RULE_TOUCHED_FIELDS.includes(field)) return true;
  return computeVisibleFields(values).has(field);
}

/** True when a field is both required (per fields.json) and currently visible -- the real "must fill this in" check. */
export function isFieldCurrentlyRequired(field: FieldKey, values: Partial<Record<FieldKey, unknown>>): boolean {
  return REQUIRED_FIELDS.has(field) && isFieldVisible(field, values);
}
