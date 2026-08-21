"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  NATURE_OF_BUSINESS_OPTIONS, BARANGAY_OPTIONS, BUSINESS_TAX_PAYMENT_OPTIONS, ORGANIZATION_TYPE_OPTIONS, REGISTRATION_AUTHORITY_OPTIONS,
  TAX_TYPE_OPTIONS, GENDER_OPTIONS, BUSINESS_ACTIVITY_OPTIONS, OPERATION_ADDRESS_OPTIONS, PREMISES_OWNERSHIP_OPTIONS,
  YES_NO_OPTIONS, BARANGAY_CLEARANCE_OPTIONS,
} from "@/lib/san-miguel-form-options";
import { isFieldVisible, REQUIRED_FIELDS, type FieldKey } from "@/lib/application-form-logic";
import { ALLOWED_TYPES, DOCUMENT_BUCKET, MAX_FILE_BYTES, MAX_FILE_MB } from "@/lib/document-upload";
import { createClient } from "@/lib/supabase/client";
import { signOutApplicant } from "@/lib/applicant-session-actions";
import type { LguDisplay } from "@/lib/lgu";
import type { LguFormOptions } from "@/lib/lgu-form-options";

/**
 * Applicant flow -- new business / renewal, phone OTP, legacy-claim, and
 * the application form. Screen sequencing and copy are ported from
 * reference/MuniServe_Applicant_Flow_Prototype.html per CLAUDE.md section
 * 8, kept as one client-side state machine (matching the prototype's own
 * structure) rather than separate routed pages, since the in-progress
 * wizard state is ephemeral and doesn't need to survive a page reload --
 * only the final submitted application does (that's /status/[reference]).
 *
 * The "form" screen itself is now built against reference/official-
 * application-form/ -- the real, currently-live BPLO intake form -- rather
 * than the smaller approximation this page started with. Field options and
 * show/hide behavior both come from shared modules (san-miguel-form-
 * options.ts, application-form-logic.ts) instead of being hand-coded here,
 * so this file stays in sync with the same rules submit-application/
 * route.ts validates against server-side.
 *
 * Extends the prototype in two ways CLAUDE.md's written description
 * (section 5) calls for but the demo doesn't show:
 *   1. A "sign in with your phone instead" link on the renewal-lookup
 *      screen, for a returning owner who doesn't have their permit handy.
 *   2. A business-picker step when a returning owner chooses to renew and
 *      turns out to have more than one business on file.
 *
 * 2026-08-16 follow-up: renewal lookup generalized from "License Number"
 * (only ever matched a still-unclaimed legacy business) to "Permit
 * Number" -- a business registered fresh through MuniServe never gets a
 * License Number at all, but every business gets a Permit Number
 * (`applications.reference_number`, printed on the actual certificate).
 * Now searches both and, for an already-claimed match, sends the OTP to
 * the real phone already on file server-side (see send-renewal-otp/
 * route.ts) rather than asking the applicant to type and correctly
 * remember which number they originally registered with.
 *
 * Takes `lgu` as a prop (CLAUDE.md 7n) rather than hardcoding San Miguel's
 * name -- fetched server-side by the thin page.tsx wrapper, since this
 * whole component is client-side (lots of wizard state) and has no
 * request context of its own to resolve an LGU from.
 */

type Screen =
  | "landing"
  | "renewal_license"
  | "renewal_confirm"
  | "phone"
  | "otp"
  | "owner_match"
  | "business_picker"
  | "form"
  | "submitted";

/** Matches src/lib/business-profile.ts's mapBusinessProfile() output -- what lookup-license/my-businesses return for renewal pre-fill. */
type BusinessProfile = {
  id: string;
  businessName: string;
  barangay: string | null;
  natureOfBusiness: string | null;
  lbtCategory: string | null;
  grossSales: number | null;
  businessTaxPayment: string | null;
  organizationType: string | null;
  registrationAuthority: string | null;
  registrationNo: string | null;
  tin: string | null;
  taxType: string | null;
  tradeName: string | null;
  unitStreet: string | null;
  cityTown: string | null;
  province: string | null;
  zipCode: string | null;
  businessActivity: string[];
  deliveryVehicleCount: string | null;
  operationAddressSame: string | null;
  operationAddress: string | null;
  businessAreaSqm: string | null;
  totalFloorAreaSqm: string | null;
  secondaryBusinessActivity: string | null;
  premisesOwnership: string | null;
  taxDeclarationNo: string | null;
  monthlyRent: string | null;
  lessorName: string | null;
  lessorContactNo: string | null;
  lessorAddress: string | null;
  hasEmployees: "Yes" | "No" | null;
  maleEmployeeCount: number | null;
  femaleEmployeeCount: number | null;
  employeesResidingInLguCount: number | null;
  hasBarangayClearance: string | null;
  hasTaxIncentives: "Yes" | "No" | null;
  billiardTableCount: number | null;
  lodgerCount: number | null;
  landAreaHectares: number | null;
  guardPostCount: number | null;
  warehouseFloorAreaSqm: number | null;
  seatingCapacity: number | null;
  isAircon: "Yes" | "No" | null;
  isBranchOffice: "Yes" | "No" | null;
  animalCount: number | null;
};

type LegacyMatch = BusinessProfile & { ownerNameMasked: string };
type ClaimedMatch = BusinessProfile & { maskedPhone: string };

type FormState = {
  businessName: string;
  natureOfBusiness: string;
  organizationType: string;
  businessTaxPayment: string;
  registrationAuthority: string;
  registrationNo: string;
  tin: string;
  taxType: string;
  tradeName: string;
  capitalInvestment: string;
  grossSales: string;
  unitStreet: string;
  cityTown: string;
  barangay: string;
  province: string;
  zipCode: string;
  businessActivity: string[];
  deliveryVehicleCount: string;
  operationAddressSame: string;
  operationAddress: string;
  businessAreaSqm: string;
  totalFloorAreaSqm: string;
  secondaryBusinessActivity: string;
  premisesOwnership: string;
  taxDeclarationNo: string;
  monthlyRent: string;
  lessorName: string;
  lessorContactNo: string;
  lessorAddress: string;
  hasEmployees: string;
  maleEmployeeCount: string;
  femaleEmployeeCount: string;
  employeesResidingInLguCount: string;
  hasBarangayClearance: string;
  hasTaxIncentives: string;
  billiardTableCount: string;
  lodgerCount: string;
  landAreaHectares: string;
  guardPostCount: string;
  warehouseFloorAreaSqm: string;
  seatingCapacity: string;
  isAircon: string;
  isBranchOffice: string;
  animalCount: string;
};

const EMPTY_FORM: FormState = {
  businessName: "", natureOfBusiness: "", organizationType: "", businessTaxPayment: "", registrationAuthority: "", registrationNo: "",
  tin: "", taxType: "", tradeName: "", capitalInvestment: "", grossSales: "",
  unitStreet: "", cityTown: "", barangay: "", province: "", zipCode: "",
  businessActivity: [], deliveryVehicleCount: "", operationAddressSame: "", operationAddress: "",
  businessAreaSqm: "", totalFloorAreaSqm: "", secondaryBusinessActivity: "",
  premisesOwnership: "", taxDeclarationNo: "", monthlyRent: "", lessorName: "", lessorContactNo: "", lessorAddress: "",
  hasEmployees: "", maleEmployeeCount: "", femaleEmployeeCount: "", employeesResidingInLguCount: "",
  hasBarangayClearance: "", hasTaxIncentives: "",
  billiardTableCount: "", lodgerCount: "", landAreaHectares: "", guardPostCount: "", warehouseFloorAreaSqm: "",
  seatingCapacity: "", isAircon: "", isBranchOffice: "", animalCount: "",
};

type DocumentFieldKey =
  | "cedulaDoc" | "govIdDoc" | "dtiSecCdaDoc" | "leaseContractDoc" | "vicinityMapDoc"
  | "barangayClearanceDoc" | "taxIncentivesDoc" | "swornStatementDoc" | "signatureDoc";

const DOCUMENT_FIELDS: { key: DocumentFieldKey; label: string }[] = [
  { key: "cedulaDoc", label: "CEDULA" },
  { key: "govIdDoc", label: "Government-issued ID" },
  { key: "dtiSecCdaDoc", label: "DTI / SEC / CDA registration" },
  { key: "leaseContractDoc", label: "Lease contract" },
  { key: "vicinityMapDoc", label: "Business location sketch / vicinity map" },
  { key: "barangayClearanceDoc", label: "Barangay clearance" },
  { key: "taxIncentivesDoc", label: "Tax incentives certificate" },
  { key: "swornStatementDoc", label: "Sworn statement of gross sales (BIR ITR / AFS / VAT returns)" },
];
const DOCUMENT_FIELD_KEYS = new Set<FieldKey>(DOCUMENT_FIELDS.map((d) => d.key));

/** 11-digit PH mobile number starting with 09, optional spaces/dashes -- a plain "is this even shaped right" check before spending a real, billed SMS credit on it (2026-08-20 audit finding: previously only checked for non-empty). */
function isValidPhFormat(value: string): boolean {
  return /^09\d{9}$/.test(value.replace(/[\s-]/g, ""));
}

/** Peso amount fields (capital investment, gross sales) had no thousands-separator display, making a mistyped extra/missing zero easy to miss (2026-08-20 audit finding). Live preview only -- the underlying stored value/validation is unchanged. */
const CURRENCY_FIELD_KEYS = new Set<FieldKey>(["capitalInvestment", "grossSales"]);
function formatPesoPreview(raw: string): string | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return `≈ ₱${n.toLocaleString("en-PH")}`;
}

/**
 * Autosaves the in-progress ~40-field form to the browser's own storage so
 * a dropped connection, an accidental back-swipe, or the phone's OS killing
 * a backgrounded tab (common on Android under memory pressure) doesn't
 * lose everything the applicant has typed (2026-08-20 audit finding --
 * previously purely in-memory, by design, per this file's own original
 * doc comment; that reasoning predates the real ~40-field form and doesn't
 * hold up for this audience). Deliberately localStorage, not sessionStorage
 * -- a backgrounded-then-reloaded mobile tab doesn't reliably count as "the
 * same session" the way it does on desktop. Only ever restores back to the
 * "form" screen itself, never re-derives a verified OTP session -- the
 * applicant_session cookie (30-day, httpOnly) already covers whether
 * they're still signed in; this only recovers what they'd typed.
 */
const DRAFT_KEY = "muniserve-apply-draft-v1";
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
type DraftState = {
  savedAt: number;
  path: "new" | "renewal" | null;
  phone: string;
  firstName: string;
  lastName: string;
  emailInput: string;
  genderInput: string;
  selectedBusinessId: string | null;
  form: FormState;
  documents: Partial<Record<DocumentFieldKey, string>>;
};

function isBlankValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

type FieldDescriptor =
  | { key: FieldKey; label: string; kind: "text" | "number" }
  | { key: FieldKey; label: string; kind: "select"; options: readonly string[] }
  | { key: FieldKey; label: string; kind: "searchable-select"; options: readonly string[] }
  | { key: FieldKey; label: string; kind: "checkboxgroup"; options: readonly string[] };

const BUSINESS_INFO_FIELDS: FieldDescriptor[] = [
  { key: "businessName", label: "Business name", kind: "text" },
  { key: "businessTaxPayment", label: "Business tax payment", kind: "select", options: BUSINESS_TAX_PAYMENT_OPTIONS },
  { key: "natureOfBusiness", label: "Nature of business", kind: "searchable-select", options: NATURE_OF_BUSINESS_OPTIONS },
  { key: "organizationType", label: "Organization type", kind: "select", options: ORGANIZATION_TYPE_OPTIONS },
  { key: "registrationAuthority", label: "Registration authority", kind: "select", options: REGISTRATION_AUTHORITY_OPTIONS },
  { key: "registrationNo", label: "DTI / SEC / CDA registration no.", kind: "text" },
  { key: "tin", label: "Tax Identification Number (TIN)", kind: "text" },
  { key: "taxType", label: "Tax type", kind: "select", options: TAX_TYPE_OPTIONS },
  { key: "tradeName", label: "Trade name or franchise name (if any)", kind: "text" },
  { key: "capitalInvestment", label: "Capital investment (₱)", kind: "number" },
  { key: "grossSales", label: "Total gross sales, preceding year (₱)", kind: "number" },
];

const ADDRESS_FIELDS: FieldDescriptor[] = [
  { key: "unitStreet", label: "Bldg. name / unit no. / street", kind: "text" },
  { key: "cityTown", label: "City / town", kind: "text" },
  { key: "barangay", label: "Barangay", kind: "select", options: BARANGAY_OPTIONS },
  { key: "province", label: "Province", kind: "text" },
  { key: "zipCode", label: "Zip code", kind: "text" },
];

const BUSINESS_OPERATION_FIELDS: FieldDescriptor[] = [
  { key: "businessActivity", label: "Business activity", kind: "checkboxgroup", options: BUSINESS_ACTIVITY_OPTIONS },
  { key: "deliveryVehicleCount", label: "No. of delivery vehicles (van/truck/motorcycle), if any", kind: "text" },
  { key: "operationAddressSame", label: "Is your main office the same as your business operation address?", kind: "select", options: OPERATION_ADDRESS_OPTIONS },
  { key: "operationAddress", label: "Business operation complete address", kind: "text" },
  { key: "businessAreaSqm", label: "Business area (sqm)", kind: "text" },
  { key: "totalFloorAreaSqm", label: "Total floor area (sqm)", kind: "text" },
  { key: "secondaryBusinessActivity", label: "Secondary business activity", kind: "text" },
  { key: "premisesOwnership", label: "Business premises ownership", kind: "select", options: PREMISES_OWNERSHIP_OPTIONS },
  { key: "taxDeclarationNo", label: "Tax declaration no. or property identification no.", kind: "text" },
  { key: "monthlyRent", label: "Monthly rent", kind: "text" },
  { key: "lessorName", label: "Lessor name", kind: "text" },
  { key: "lessorContactNo", label: "Lessor contact no.", kind: "text" },
  { key: "lessorAddress", label: "Lessor complete address", kind: "text" },
  { key: "hasEmployees", label: "Do you have employees?", kind: "select", options: YES_NO_OPTIONS },
  { key: "maleEmployeeCount", label: "Total male employees", kind: "number" },
  { key: "femaleEmployeeCount", label: "Total female employees", kind: "number" },
  { key: "employeesResidingInLguCount", label: "Total employees residing in the LGU", kind: "number" },
  { key: "hasBarangayClearance", label: "Do you have a barangay clearance?", kind: "select", options: BARANGAY_CLEARANCE_OPTIONS },
  { key: "hasTaxIncentives", label: "Do you have tax incentives from any government entity?", kind: "select", options: YES_NO_OPTIONS },
  { key: "billiardTableCount", label: "Number of billiard tables", kind: "number" },
  { key: "lodgerCount", label: "Number of lodgers / rooms", kind: "number" },
  { key: "landAreaHectares", label: "Land area (hectares)", kind: "number" },
  { key: "guardPostCount", label: "Number of localities with posted guards", kind: "number" },
  { key: "warehouseFloorAreaSqm", label: "Floor area (sqm)", kind: "number" },
  { key: "seatingCapacity", label: "Seating capacity", kind: "number" },
  { key: "isAircon", label: "Air-conditioned?", kind: "select", options: YES_NO_OPTIONS },
  { key: "isBranchOffice", label: "Is branch office?", kind: "select", options: YES_NO_OPTIONS },
  { key: "animalCount", label: "Number of animals", kind: "number" },
];

/**
 * Swaps in this LGU's own options for whichever fields have a per-LGU
 * override (CLAUDE.md 7o follow-up, migration 0021) -- BUSINESS_INFO_FIELDS
 * and ADDRESS_FIELDS above stay as the static shape/label source (fieldLabel()
 * still reads from them directly, since a label never varies by LGU), while
 * the actual rendered field list is built per-render from this LGU's
 * formOptions instead. barangay gets no options fallback -- see
 * lgu-form-options.ts for why an empty barangay list degrades this one
 * field to free text rather than showing an empty or wrong dropdown.
 */
function withDynamicOptions(fields: FieldDescriptor[], overrides: Partial<Record<FieldKey, readonly string[]>>): FieldDescriptor[] {
  return fields.map((f) => {
    if (f.kind !== "select" && f.kind !== "searchable-select" && f.kind !== "checkboxgroup") return f;
    const override = overrides[f.key];
    if (!override) return f;
    if (override.length === 0) return { key: f.key, label: f.label, kind: "text" as const };
    return { ...f, options: override };
  });
}

/** Turns a raw FieldKey (what the server's missing_required_fields error returns) into the same label shown on the form, instead of the camelCase key itself. */
function fieldLabel(key: string): string {
  const found =
    BUSINESS_INFO_FIELDS.find((f) => f.key === key) ??
    ADDRESS_FIELDS.find((f) => f.key === key) ??
    BUSINESS_OPERATION_FIELDS.find((f) => f.key === key);
  if (found) return found.label;
  const doc = DOCUMENT_FIELDS.find((d) => d.key === key);
  return doc ? doc.label : key;
}

function declarationText(lgu: LguDisplay): string {
  return (
    "I DECLARE UNDER PENALTY OF PERJURY that all information in this application are true and correct based on my " +
    `personal knowledge and authentic records submitted to the BPLO ${lgu.name}${lgu.province ? ` ${lgu.province}` : ""}. Any false or misleading ` +
    "information supplied, or production of fake/falsified documents shall be grounds for appropriate legal action " +
    "against me and automatically revokes the permit. I hereby agree that all personal data (as defined under the " +
    "Data Privacy Law of 2012 and its implementing Rules and Regulations) and account transactions information or " +
    "records with the City/Municipal Government may be processed, profiled or shared to requesting or for the " +
    "purpose of any court legal process, examination, inquiry, and audit or investigation or any authority."
  );
}

export function ApplyPageClient({ lgu, formOptions }: { lgu: LguDisplay; formOptions: LguFormOptions }) {
  const [screen, setScreen] = useState<Screen>("landing");
  const [path, setPath] = useState<"new" | "renewal" | null>(null);
  const [phoneSigninMode, setPhoneSigninMode] = useState(false);

  const [permitNumberInput, setPermitNumberInput] = useState("");
  const [matchedLegacy, setMatchedLegacy] = useState<LegacyMatch | null>(null);
  const [claimedMatch, setClaimedMatch] = useState<ClaimedMatch | null>(null);
  const [noMatch, setNoMatch] = useState(false);
  const [renewalOtpSent, setRenewalOtpSent] = useState(false);

  const [phone, setPhone] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [genderInput, setGenderInput] = useState("");
  const [businessCount, setBusinessCount] = useState(0);
  const [myBusinesses, setMyBusinesses] = useState<BusinessProfile[] | null>(null);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [documents, setDocuments] = useState<Partial<Record<DocumentFieldKey, string>>>({});
  const [uploadingDoc, setUploadingDoc] = useState<DocumentFieldKey | null>(null);
  const [declarationAccepted, setDeclarationAccepted] = useState(false);

  const [submittedReference, setSubmittedReference] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Lets an LGU embed this page as an iframe on their own website without
   * an awkward fixed-height scrollbar (CLAUDE.md 7o follow-up) -- posts
   * this page's real content height to whatever embeds it every time it
   * changes (screen changes, validation errors, conditional fields...),
   * via a ResizeObserver rather than trying to enumerate every state
   * change that could affect height. The embed snippet
   * (src/lib/embed.ts's buildApplyEmbedSnippet) listens for this exact
   * message shape and resizes its <iframe> to match. Harmless no-op when
   * this page isn't actually embedded -- window.parent === window, and
   * nothing listens for this message shape on the page itself.
   */
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      window.parent.postMessage({ source: "muniserve-apply", height: el.scrollHeight }, "*");
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Restore a saved draft once, on mount, if one exists and isn't stale.
  // Runs before the user has interacted with anything, so this is the one
  // legitimate case of setting state from an effect on mount rather than
  // during a later render -- restoring nine independent useState slices
  // from one saved object, so (unlike theme-toggle.tsx's identical-in-kind
  // case) there's no single value to hoist out to make one eslint-disable-
  // next-line cover them all. A block disable/enable pair around exactly
  // this restore, not a blanket file-level suppression.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as DraftState;
      if (!draft.savedAt || Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) {
        window.localStorage.removeItem(DRAFT_KEY);
        return;
      }
      setPath(draft.path);
      setPhone(draft.phone);
      setFirstName(draft.firstName);
      setLastName(draft.lastName);
      setEmailInput(draft.emailInput);
      setGenderInput(draft.genderInput);
      setSelectedBusinessId(draft.selectedBusinessId);
      setForm(draft.form);
      setDocuments(draft.documents);
      setScreen("form");
    } catch {
      // A corrupted/unreadable draft is never worth blocking the page over -- just start fresh.
      window.localStorage.removeItem(DRAFT_KEY);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Autosaves the draft on every change while the applicant is actually on
  // the form screen -- not on every screen, so a half-completed phone/OTP
  // step never gets restored as if it were a filled-in form.
  useEffect(() => {
    if (screen !== "form") return;
    const draft: DraftState = { savedAt: Date.now(), path, phone, firstName, lastName, emailInput, genderInput, selectedBusinessId, form, documents };
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Storage full/unavailable (private browsing, etc.) -- autosave is a convenience, not a requirement.
    }
  }, [screen, path, phone, firstName, lastName, emailInput, genderInput, selectedBusinessId, form, documents]);

  function clearDraft() {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Nothing to do if storage isn't available.
    }
  }

  /**
   * "Start over" used to only ever reset local React state -- the real
   * applicant_session cookie (and its server-side row) stayed live for its
   * full 30 days regardless, so on a shared/public device the next person
   * could still submit under the previous person's identity with no OTP.
   * Now actually revokes the session server-side first (signOutApplicant),
   * so this is a real sign-out, not just a fresh-looking form.
   */
  function startOver() {
    void signOutApplicant();
    clearDraft();
    setScreen("landing");
    setPath(null);
    setPhoneSigninMode(false);
    setPermitNumberInput("");
    setMatchedLegacy(null);
    setClaimedMatch(null);
    setNoMatch(false);
    setRenewalOtpSent(false);
    setPhone("");
    setOtpInput("");
    setOtpSent(false);
    setFirstName("");
    setLastName("");
    setEmailInput("");
    setGenderInput("");
    setBusinessCount(0);
    setMyBusinesses(null);
    setSelectedBusinessId(null);
    setForm(EMPTY_FORM);
    setDocuments({});
    setDeclarationAccepted(false);
    setSubmittedReference(null);
    setError(null);
  }

  function applyProfile(profile: BusinessProfile) {
    setSelectedBusinessId(profile.id);
    setForm((f) => ({
      ...f,
      businessName: profile.businessName,
      natureOfBusiness: profile.natureOfBusiness ?? "",
      organizationType: profile.organizationType ?? "",
      businessTaxPayment: profile.businessTaxPayment ?? "",
      registrationAuthority: profile.registrationAuthority ?? "",
      registrationNo: profile.registrationNo ?? "",
      tin: profile.tin ?? "",
      taxType: profile.taxType ?? "",
      tradeName: profile.tradeName ?? "",
      grossSales: profile.grossSales != null ? String(profile.grossSales) : "",
      unitStreet: profile.unitStreet ?? "",
      cityTown: profile.cityTown ?? "",
      barangay: profile.barangay ?? "",
      province: profile.province ?? "",
      zipCode: profile.zipCode ?? "",
      businessActivity: profile.businessActivity ?? [],
      deliveryVehicleCount: profile.deliveryVehicleCount ?? "",
      operationAddressSame: profile.operationAddressSame ?? "",
      operationAddress: profile.operationAddress ?? "",
      businessAreaSqm: profile.businessAreaSqm ?? "",
      totalFloorAreaSqm: profile.totalFloorAreaSqm ?? "",
      secondaryBusinessActivity: profile.secondaryBusinessActivity ?? "",
      premisesOwnership: profile.premisesOwnership ?? "",
      taxDeclarationNo: profile.taxDeclarationNo ?? "",
      monthlyRent: profile.monthlyRent ?? "",
      lessorName: profile.lessorName ?? "",
      lessorContactNo: profile.lessorContactNo ?? "",
      lessorAddress: profile.lessorAddress ?? "",
      hasEmployees: profile.hasEmployees ?? "",
      maleEmployeeCount: profile.maleEmployeeCount != null ? String(profile.maleEmployeeCount) : "",
      femaleEmployeeCount: profile.femaleEmployeeCount != null ? String(profile.femaleEmployeeCount) : "",
      employeesResidingInLguCount: profile.employeesResidingInLguCount != null ? String(profile.employeesResidingInLguCount) : "",
      hasBarangayClearance: profile.hasBarangayClearance ?? "",
      hasTaxIncentives: profile.hasTaxIncentives ?? "",
      billiardTableCount: profile.billiardTableCount != null ? String(profile.billiardTableCount) : "",
      lodgerCount: profile.lodgerCount != null ? String(profile.lodgerCount) : "",
      landAreaHectares: profile.landAreaHectares != null ? String(profile.landAreaHectares) : "",
      guardPostCount: profile.guardPostCount != null ? String(profile.guardPostCount) : "",
      warehouseFloorAreaSqm: profile.warehouseFloorAreaSqm != null ? String(profile.warehouseFloorAreaSqm) : "",
      seatingCapacity: profile.seatingCapacity != null ? String(profile.seatingCapacity) : "",
      isAircon: profile.isAircon ?? "",
      isBranchOffice: profile.isBranchOffice ?? "",
      animalCount: profile.animalCount != null ? String(profile.animalCount) : "",
    }));
  }

  async function lookupPermitNumber() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/applicant/lookup-license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permitNumber: permitNumberInput.trim() }),
      });
      const data = await res.json();
      if (data.found && data.claimed) {
        setMatchedLegacy(null);
        setClaimedMatch(data.business);
        setNoMatch(false);
      } else if (data.found) {
        setMatchedLegacy(data.business);
        setClaimedMatch(null);
        setNoMatch(false);
      } else {
        setMatchedLegacy(null);
        setClaimedMatch(null);
        setNoMatch(true);
      }
      setScreen("renewal_confirm");
    } finally {
      setLoading(false);
    }
  }

  async function sendOtp() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/applicant/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.error === "too_soon"
            ? "Please wait a bit before requesting another code."
            : data.error === "too_many_requests"
              ? "Too many codes requested from this connection. Please wait a few minutes and try again."
              : "Could not send a code to that number. Check it and try again."
        );
        return;
      }
      setOtpSent(true);
      setScreen("otp");
    } finally {
      setLoading(false);
    }
  }

  /** Permit Number renewal lookup's own send step (2026-08-16) -- the destination phone is resolved server-side from claimedMatch's own linked owner, never something this client knows or supplies (see send-renewal-otp/route.ts). */
  async function sendRenewalOtp() {
    if (!claimedMatch) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/applicant/send-renewal-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: claimedMatch.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error === "too_soon" ? "Please wait a bit before requesting another code." : "Could not send a code right now — try again in a moment.");
        return;
      }
      setRenewalOtpSent(true);
      setOtpSent(true);
      setScreen("otp");
    } finally {
      setLoading(false);
    }
  }

  async function fetchMyBusinesses(): Promise<BusinessProfile[]> {
    const res = await fetch("/api/applicant/my-businesses");
    const data = await res.json();
    const businesses: BusinessProfile[] = data.businesses ?? [];
    setMyBusinesses(businesses);
    return businesses;
  }

  async function verifyOtp() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/applicant/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          code: otpInput.trim(),
          legacyBusinessId: path === "renewal" && matchedLegacy ? matchedLegacy.id : undefined,
          businessId: path === "renewal" && claimedMatch ? claimedMatch.id : undefined,
        }),
      });
      if (!res.ok) {
        setError("That code didn't work — check it and try again, or request a new one.");
        return;
      }
      const data = await res.json();
      setBusinessCount(data.businessCount);
      // The businessId-driven renewal path never has the applicant type
      // their own phone (server-resolved, see verify-otp/route.ts) --
      // `phone` state stays populated from here on, matching every other
      // path where it's set on the earlier "phone" screen. Without this,
      // the read-only "Mobile phone" field on the form stayed blank for
      // that one path, and since it's a required field, silently blocked
      // the Documents section from ever appearing (caught live).
      if (data.phone) setPhone(data.phone);
      // Placeholder-named owners (brand new, or claimed-but-unnamed legacy)
      // have full_name === phone -- leave the name fields blank for those
      // rather than pre-filling with the phone number itself.
      if (data.ownerName && data.ownerName !== data.phone) {
        const [first, ...rest] = String(data.ownerName).split(" ");
        setFirstName(first ?? "");
        setLastName(rest.join(" "));
      } else {
        setFirstName("");
        setLastName("");
      }
      setEmailInput(data.ownerEmail ?? "");
      setGenderInput(data.ownerGender ?? "");

      if (path === "renewal" && matchedLegacy) {
        // Legacy claim just completed -- go straight to the form for that business.
        applyProfile(matchedLegacy);
        setScreen("form");
      } else if (path === "renewal" && claimedMatch) {
        // Permit Number lookup found an already-claimed business and the
        // applicant just proved control of its real phone -- straight to
        // that specific business's form, same as the legacy-claim path.
        applyProfile(claimedMatch);
        setScreen("form");
      } else if (path === "renewal" && phoneSigninMode) {
        // Returning owner signing in by phone for a later renewal.
        if (!data.matched) {
          setError("We don't have an account under this number yet. If you have an existing business, please use your Permit No. or License No. instead.");
          setScreen("renewal_license");
          return;
        }
        const businesses = await fetchMyBusinesses();
        if (businesses.length === 1) {
          applyProfile(businesses[0]);
          setScreen("form");
        } else {
          setScreen("business_picker");
        }
      } else if (data.matched) {
        setScreen("owner_match");
      } else {
        setScreen("form");
      }
    } finally {
      setLoading(false);
    }
  }

  function pickBusiness(b: BusinessProfile) {
    applyProfile(b);
    setScreen("form");
  }

  async function uploadDocument(key: DocumentFieldKey, label: string, file: File) {
    setUploadingDoc(key);
    setError(null);
    try {
      if (!ALLOWED_TYPES.includes(file.type)) {
        setError("Please upload a PDF or image (JPG, PNG, or WEBP).");
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError(`That file is too large (${MAX_FILE_MB}MB max).`);
        return;
      }

      // Uploads straight to Supabase Storage via a signed URL (2026-08-17)
      // rather than through our own server -- a real scanned government
      // document routinely exceeds Vercel's ~4.5MB function request-body
      // ceiling, confirmed empirically, which no declared limit on our
      // own route was ever going to change.
      const urlRes = await fetch("/api/applicant/request-upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type, fileName: file.name }),
      });
      if (!urlRes.ok) {
        setError("Could not start that upload — try again in a moment.");
        return;
      }
      const { path, token } = await urlRes.json();

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (uploadError) {
        setError("Could not upload that file — check your connection and try again.");
        return;
      }

      const registerRes = await fetch("/api/applicant/upload-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, documentType: label }),
      });
      if (!registerRes.ok) {
        setError("Could not save that upload — try again.");
        return;
      }
      const data = await registerRes.json();
      setDocuments((prev) => ({ ...prev, [key]: data.documentId }));
    } finally {
      setUploadingDoc(null);
    }
  }

  function buildVisibleValues(): Partial<Record<FieldKey, unknown>> {
    return {
      applicationType: path === "new" ? "New" : path === "renewal" ? "Renewal" : "",
      firstName,
      lastName,
      email: emailInput,
      phone,
      gender: genderInput,
      ...form,
      // A New business always pays the full annual Business Tax -- locked
      // rather than a free choice, overriding whatever's in form state so
      // the required-field/readyForDocuments check doesn't wait on a value
      // the applicant is never shown a control for. Only Renewal gets the
      // real Annual/Bi-Annually/Quarterly choice (project owner's own
      // request, 2026-08-19).
      ...(path === "new" ? { businessTaxPayment: "Annual" } : {}),
    };
  }

  async function submitApplication() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/applicant/submit-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationType: path,
          businessId: selectedBusinessId ?? undefined,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: emailInput.trim(),
          gender: genderInput || undefined,
          businessName: form.businessName,
          natureOfBusiness: form.natureOfBusiness,
          organizationType: form.organizationType,
          businessTaxPayment: path === "new" ? "Annual" : form.businessTaxPayment || undefined,
          registrationAuthority: form.registrationAuthority || undefined,
          registrationNo: form.registrationNo || undefined,
          tin: form.tin || undefined,
          taxType: form.taxType || undefined,
          tradeName: form.tradeName || undefined,
          capitalInvestment: form.capitalInvestment ? Number(form.capitalInvestment) : undefined,
          grossSales: form.grossSales ? Number(form.grossSales) : undefined,
          unitStreet: form.unitStreet || undefined,
          cityTown: form.cityTown || undefined,
          barangay: form.barangay || undefined,
          province: form.province || undefined,
          zipCode: form.zipCode || undefined,
          businessActivity: form.businessActivity.length ? form.businessActivity : undefined,
          deliveryVehicleCount: form.deliveryVehicleCount || undefined,
          operationAddressSame: form.operationAddressSame || undefined,
          operationAddress: form.operationAddress || undefined,
          businessAreaSqm: form.businessAreaSqm || undefined,
          totalFloorAreaSqm: form.totalFloorAreaSqm || undefined,
          secondaryBusinessActivity: form.secondaryBusinessActivity || undefined,
          premisesOwnership: form.premisesOwnership || undefined,
          taxDeclarationNo: form.taxDeclarationNo || undefined,
          monthlyRent: form.monthlyRent || undefined,
          lessorName: form.lessorName || undefined,
          lessorContactNo: form.lessorContactNo || undefined,
          lessorAddress: form.lessorAddress || undefined,
          hasEmployees: form.hasEmployees || undefined,
          maleEmployeeCount: form.maleEmployeeCount ? Number(form.maleEmployeeCount) : undefined,
          femaleEmployeeCount: form.femaleEmployeeCount ? Number(form.femaleEmployeeCount) : undefined,
          employeesResidingInLguCount: form.employeesResidingInLguCount ? Number(form.employeesResidingInLguCount) : undefined,
          hasBarangayClearance: form.hasBarangayClearance || undefined,
          hasTaxIncentives: form.hasTaxIncentives || undefined,
          billiardTableCount: form.billiardTableCount ? Number(form.billiardTableCount) : undefined,
          lodgerCount: form.lodgerCount ? Number(form.lodgerCount) : undefined,
          landAreaHectares: form.landAreaHectares ? Number(form.landAreaHectares) : undefined,
          guardPostCount: form.guardPostCount ? Number(form.guardPostCount) : undefined,
          warehouseFloorAreaSqm: form.warehouseFloorAreaSqm ? Number(form.warehouseFloorAreaSqm) : undefined,
          seatingCapacity: form.seatingCapacity ? Number(form.seatingCapacity) : undefined,
          isAircon: form.isAircon || undefined,
          isBranchOffice: form.isBranchOffice || undefined,
          animalCount: form.animalCount ? Number(form.animalCount) : undefined,
          declarationAccepted,
          documents,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.error === "missing_required_fields"
            ? `Please fill in: ${(data.fields ?? []).map(fieldLabel).join(", ")}`
            : data.error === "declaration_not_accepted"
              ? "Please accept the declaration before submitting."
              // Rare: the LGU was paused after this tab was already open
              // (CLAUDE.md 7o follow-up) -- apply/page.tsx normally
              // catches this on load, this is just the stale-tab case.
              : data.error === "lgu_paused"
                ? "Online applications for this LGU are temporarily unavailable. Please refresh this page for details."
                : "Something went wrong submitting your application. Please try again."
        );
        return;
      }
      const data = await res.json();
      clearDraft();
      setSubmittedReference(data.referenceNumber);
      setScreen("submitted");
    } finally {
      setLoading(false);
    }
  }

  const formValues = buildVisibleValues();

  // This LGU's own picklists (CLAUDE.md 7o follow-up) swapped into the
  // otherwise-static field descriptors -- see withDynamicOptions() above.
  const businessInfoFieldsForRender = useMemo(
    () => withDynamicOptions(BUSINESS_INFO_FIELDS, { natureOfBusiness: formOptions.natureOfBusinessOptions }),
    [formOptions.natureOfBusinessOptions]
  );
  const addressFieldsForRender = useMemo(
    () => withDynamicOptions(ADDRESS_FIELDS, { barangay: formOptions.barangayOptions }),
    [formOptions.barangayOptions]
  );

  /**
   * Matches the real form's own behavior: document uploads, signature, and
   * the declaration/submit step only appear once every other currently-
   * required field has a value -- not unconditionally alongside everything
   * else. Document fields themselves are excluded here (obviously nothing
   * can be uploaded to a section that isn't shown yet); declarationAccepted
   * is its own final checkbox, not a prerequisite for showing that checkbox.
   */
  // 2026-08-16 follow-up: a returning owner's renewal is pre-filled from
  // their existing (sometimes sparse legacy-import) profile, so most
  // fields already look done -- if one cascade-gating field (Business
  // Operation's "same address?" -> premises ownership -> employees ->
  // barangay clearance/tax incentives, each hidden until the one above it
  // is answered) is the only thing left blank, this section's own bare
  // "fill in the required fields above" gave no hint of which one. Now
  // lists them by name instead of leaving the applicant to hunt.
  const missingRequiredFields = [...REQUIRED_FIELDS].filter(
    (key) =>
      key !== "declarationAccepted" &&
      !DOCUMENT_FIELD_KEYS.has(key) &&
      isFieldVisible(key, formValues) &&
      isBlankValue(formValues[key])
  );
  const readyForDocuments = missingRequiredFields.length === 0;

  function renderField(fd: FieldDescriptor) {
    if (!isFieldVisible(fd.key, formValues)) return null;
    const required = REQUIRED_FIELDS.has(fd.key);
    // Checkboxes read ambiguously as single- vs multi-select at a glance,
    // especially at this form's small font sizes -- a plain hint removes
    // the guesswork instead of relying on the applicant already knowing
    // the convention (copy-only clarity fix, no change to which fields
    // are checkbox groups or how many can be selected).
    const label = fd.label + (fd.kind === "checkboxgroup" ? " (select all that apply)" : "") + (required ? " *" : "");

    // A New business always pays the full annual amount -- shown locked,
    // not a real dropdown, so there's nothing to click here. Renewal
    // below still gets the normal 3-option select.
    if (fd.key === "businessTaxPayment" && path === "new") {
      return (
        <Field key={fd.key} id={fd.key} label={label}>
          <input id={fd.key} value="Annual" readOnly style={{ ...inputStyle, background: "#f4f6fb", color: "#6b7280" }} />
          <span style={{ fontSize: 13, color: "#9199a8", marginTop: 4, display: "block" }}>
            New businesses pay the full year&rsquo;s business tax upfront. Bi-Annual and Quarterly are only available on renewal.
          </span>
        </Field>
      );
    }

    if (fd.kind === "checkboxgroup") {
      const current = (form[fd.key as keyof FormState] as string[]) ?? [];
      // A <fieldset>/<legend> (not Field's own <label>) so a screen reader
      // announces "N related options," the way a group of checkboxes is
      // meant to be announced -- Field's plain label-next-to-a-<div> never
      // conveyed that they were a group at all (2026-08-20 audit finding).
      return (
        <fieldset key={fd.key} style={{ marginBottom: 12, border: "none", padding: 0, margin: "0 0 12px" }}>
          <legend style={{ display: "block", fontSize: 14, color: "#6b7280", marginBottom: 4, padding: 0 }}>{label}</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {fd.options.map((opt) => (
              <label key={opt} style={{ fontSize: 15, display: "flex", alignItems: "center", gap: 6, minHeight: 32 }}>
                <input
                  type="checkbox"
                  checked={current.includes(opt)}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      [fd.key]: e.target.checked ? [...current, opt] : current.filter((o) => o !== opt),
                    }))
                  }
                  style={{ width: 18, height: 18 }}
                />
                {opt}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }

    const value = (form[fd.key as keyof FormState] as string) ?? "";
    if (fd.kind === "select") {
      return (
        <Field key={fd.key} id={fd.key} label={label}>
          <select id={fd.key} value={value} onChange={(e) => setForm((f) => ({ ...f, [fd.key]: e.target.value }))} style={inputStyle}>
            <option value="">Select one</option>
            {fd.options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </Field>
      );
    }
    if (fd.kind === "searchable-select") {
      return (
        <Field key={fd.key} id={fd.key} label={label}>
          <SearchableSelect id={fd.key} value={value} onChange={(v) => setForm((f) => ({ ...f, [fd.key]: v }))} options={fd.options} />
        </Field>
      );
    }
    const pesoPreview = CURRENCY_FIELD_KEYS.has(fd.key) ? formatPesoPreview(value) : null;
    return (
      <Field key={fd.key} id={fd.key} label={label}>
        <input
          id={fd.key}
          type={fd.kind === "number" ? "number" : "text"}
          value={value}
          onChange={(e) => setForm((f) => ({ ...f, [fd.key]: e.target.value }))}
          style={inputStyle}
        />
        {pesoPreview && <span style={{ fontSize: 13, color: "#6b7280", marginTop: 4, display: "block" }}>{pesoPreview}</span>}
      </Field>
    );
  }

  // fontFamily deliberately not overridden here -- layout.tsx already sets
  // Nunito app-wide precisely so the applicant-facing pages read as the
  // same product as the staff dashboard, not a different one; an inline
  // system-font override on this root div was silently fighting that
  // (2026-08-20 audit finding).
  return (
    <div ref={rootRef} style={{ maxWidth: 780, margin: "32px auto", background: "#fff", borderRadius: 16, padding: 24, border: FIELD_BORDER, color: "#1a1a2e" }}>
      <LguBanner lgu={lgu} />
      {screen !== "landing" && screen !== "submitted" && (
        <button onClick={startOver} style={backBtnStyle}>Start over</button>
      )}
      {error && (
        <div style={{ background: "#FCEBEB", color: "#791F1F", fontSize: 14, padding: "8px 12px", borderRadius: 8, marginBottom: 16 }}>{error}</div>
      )}

      {screen === "landing" && (
        <>
          <Head title="MuniServe" sub={`${lgu.name}, ${lgu.province} · Business permit application`} />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <OptCard title="New business" desc="First time applying for a permit with this business." onClick={() => { setPath("new"); setPhoneSigninMode(false); setScreen("phone"); }} />
            <OptCard title="Renew existing permit" desc="Already have a business registered with the municipality." onClick={() => { setPath("renewal"); setPhoneSigninMode(false); setScreen("renewal_license"); }} />
          </div>
        </>
      )}

      {screen === "renewal_license" && (
        <>
          <Head title="Find your business" sub="Enter the Permit Number printed on your last permit or receipt, or your old License Number if you haven't renewed with us before." />
          <Field label="Permit No. or License No." id="permitNumberInput">
            <input id="permitNumberInput" value={permitNumberInput} onChange={(e) => setPermitNumberInput(e.target.value)} placeholder="e.g. MS-2026-00001 or your old License No." style={inputStyle} />
          </Field>
          <button onClick={lookupPermitNumber} disabled={loading || !permitNumberInput.trim()} style={{ ...actBtnStyle, ...((loading || !permitNumberInput.trim()) ? disabledBtnStyle : {}) }}>Continue</button>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 16 }}>
            Don&rsquo;t have either number handy?{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); setPhoneSigninMode(true); setScreen("phone"); }} style={{ color: "#0C447C" }}>
              Sign in with your phone instead
            </a>.
          </p>
        </>
      )}

      {screen === "renewal_confirm" && (
        noMatch ? (
          <>
            <Head title="No match found" sub="We could not find a business with that Permit No. or License No. Please check the number or visit the BPLO counter for assistance." />
            <button onClick={() => setScreen("renewal_license")} style={actBtnStyle}>Try again</button>
          </>
        ) : claimedMatch ? (
          <>
            <Head title="Is this your business?" sub="This business is already registered. We'll text a one-time code to the mobile number on file." />
            <div style={cardStyle}>
              <p style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>{claimedMatch.businessName}</p>
              <p style={{ fontSize: 14, color: "#6b7280" }}>Registered mobile number ending in {claimedMatch.maskedPhone.slice(-4)}</p>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={sendRenewalOtp} disabled={loading} style={{ ...actBtnStyle, ...(loading ? disabledBtnStyle : {}) }}>Send code to this number</button>
              <button onClick={() => { setClaimedMatch(null); setScreen("renewal_license"); }} style={actBtnStyle}>Not me</button>
            </div>
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 16 }}>
              That&rsquo;s not your number anymore? Please visit the BPLO office to have it updated.
            </p>
          </>
        ) : matchedLegacy && (
          <>
            <Head title="Is this your business?" sub="We found a record under that number. Confirm before continuing." />
            <div style={cardStyle}>
              <p style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>{matchedLegacy.businessName}</p>
              <p style={{ fontSize: 14, color: "#6b7280" }}>
                Owner on file: {matchedLegacy.ownerNameMasked} · {matchedLegacy.barangay} · {matchedLegacy.natureOfBusiness}
              </p>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setScreen("phone")} style={actBtnStyle}>Yes, this is my business</button>
              <button onClick={() => { setMatchedLegacy(null); setScreen("renewal_license"); }} style={actBtnStyle}>Not me</button>
            </div>
          </>
        )
      )}

      {screen === "phone" && (
        <>
          <Head title="Verify your mobile number" sub="We will send a one-time code by SMS. No password to remember — you will use this number every time you check your application." />
          <Field label="Mobile number" id="phone">
            <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09XX XXX XXXX" style={inputStyle} inputMode="tel" autoComplete="tel" />
          </Field>
          {phone.trim().length > 0 && !isValidPhFormat(phone) && (
            <p style={{ fontSize: 13, color: "#791F1F", marginTop: -6, marginBottom: 10 }}>
              Enter an 11-digit mobile number starting with 09 (e.g. 09171234567).
            </p>
          )}
          <button onClick={sendOtp} disabled={loading || !isValidPhFormat(phone)} style={{ ...actBtnStyle, ...((loading || !isValidPhFormat(phone)) ? disabledBtnStyle : {}) }}>{loading ? "Sending…" : "Send code"}</button>
        </>
      )}

      {screen === "otp" && (
        <>
          <Head
            title="Enter the code"
            sub={
              renewalOtpSent && claimedMatch
                ? `We sent a 6-digit code to the number ending in ${claimedMatch.maskedPhone.slice(-4)}.`
                : `We sent a 6-digit code to ${phone}.`
            }
          />
          <Field label="Verification code" id="otpCode">
            <input id="otpCode" value={otpInput} onChange={(e) => setOtpInput(e.target.value)} placeholder="6-digit code" style={inputStyle} inputMode="numeric" autoComplete="one-time-code" />
          </Field>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={verifyOtp} disabled={loading || otpInput.trim().length !== 6} style={{ ...actBtnStyle, ...((loading || otpInput.trim().length !== 6) ? disabledBtnStyle : {}) }}>Verify</button>
            <button onClick={renewalOtpSent && claimedMatch ? sendRenewalOtp : sendOtp} disabled={loading} style={{ ...actBtnStyle, ...(loading ? disabledBtnStyle : {}) }}>Resend code</button>
          </div>
          {otpSent && <p style={{ fontSize: 13, color: "#6b7280", marginTop: 10 }}>Code sent via SMS.</p>}
        </>
      )}

      {screen === "owner_match" && (
        <>
          <Head title="We found an account" sub="A profile already exists for this mobile number." />
          <div style={cardStyle}>
            <p style={{ fontSize: 15, fontWeight: 500 }}>Welcome back</p>
            <p style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>{businessCount} business{businessCount === 1 ? "" : "es"} currently on file</p>
          </div>
          <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 10 }}>This new business will be added to your existing profile, no separate account needed.</p>
          <button onClick={() => setScreen("form")} style={actBtnStyle}>Continue</button>
        </>
      )}

      {screen === "business_picker" && myBusinesses && (
        <>
          <Head title="Which business are you renewing?" sub="Select one to continue." />
          <div style={{ border: FIELD_BORDER, borderRadius: 8 }}>
            {myBusinesses.map((b) => (
              <button key={b.id} onClick={() => pickBusiness(b)} style={{ ...rowStyle, width: "100%", background: "#fff", font: "inherit", color: "inherit", textAlign: "left" }}>
                <div>
                  <p style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>{b.businessName}</p>
                  <p style={{ fontSize: 14, color: "#6b7280", margin: 0 }}>{b.barangay} · {b.natureOfBusiness}</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {screen === "form" && (
        <>
          <Head title="Business permit application" sub={`${path === "renewal" ? "Renewal" : "New application"} · ${lgu.name}, ${lgu.province}`} />
          {path === "renewal" && (
            <div style={{ ...cardStyle, background: "#f4f6fb", border: "none" }}>
              <p style={{ fontSize: 14, color: "#6b7280" }}>Pre-filled from your existing record, update anything that has changed.</p>
            </div>
          )}

          <SectionHeading>Business information & registration</SectionHeading>
          {businessInfoFieldsForRender.map(renderField)}

          <SectionHeading>Main office address</SectionHeading>
          {addressFieldsForRender.map(renderField)}

          <SectionHeading>Owner / representative info</SectionHeading>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: -6, marginBottom: 12 }}>
            For a corporation, cooperative, or partnership, enter the name of the president or officer-in-charge.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <Field label="First name *" id="firstName">
              <input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Juan" style={inputStyle} autoComplete="given-name" />
            </Field>
            <Field label="Last name *" id="lastName">
              <input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Dela Cruz" style={inputStyle} autoComplete="family-name" />
            </Field>
          </div>
          <Field label="Email *" id="ownerEmail">
            <input id="ownerEmail" type="email" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} placeholder="juan@example.com" style={inputStyle} autoComplete="email" />
          </Field>
          <Field label="Mobile phone *" id="ownerPhoneDisplay">
            <input id="ownerPhoneDisplay" value={phone} readOnly style={{ ...inputStyle, background: "#f4f6fb", color: "#6b7280" }} />
          </Field>
          <Field label="Owner's gender (optional)" id="ownerGender">
            <select id="ownerGender" value={genderInput} onChange={(e) => setGenderInput(e.target.value)} style={inputStyle}>
              <option value="">Prefer not to say</option>
              {GENDER_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: -6, marginBottom: 14 }}>
            Your mobile number is tied to your verified sign-in and can&rsquo;t be changed here — use &ldquo;Start over&rdquo; if it&rsquo;s wrong.
          </p>

          <SectionHeading>Business operation</SectionHeading>
          {BUSINESS_OPERATION_FIELDS.map(renderField)}

          {readyForDocuments ? (
            <>
              <SectionHeading>Documents to submit</SectionHeading>
              {DOCUMENT_FIELDS.filter((d) => isFieldVisible(d.key, formValues) && !(d.key === "cedulaDoc" && lgu.cedulaIncludedOnline)).map((d) => (
                <div key={d.key} style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", marginBottom: 6 }}>
                  <span style={{ fontSize: 14 }}>
                    {d.label}{REQUIRED_FIELDS.has(d.key) ? " *" : ""}{documents[d.key] ? " ✓" : ""}
                  </span>
                  <label style={{ ...actBtnStyle, display: "inline-block" }}>
                    {uploadingDoc === d.key ? "Uploading…" : documents[d.key] ? "Replace" : "Choose file"}
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      style={{ display: "none" }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDocument(d.key, d.label, f); }}
                    />
                  </label>
                </div>
              ))}
              <SignaturePad
                saving={uploadingDoc === "signatureDoc"}
                saved={Boolean(documents.signatureDoc)}
                onSave={(file) => uploadDocument("signatureDoc", "Signature", file)}
              />

              <div style={{ ...cardStyle, marginTop: 12 }}>
                <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>{declarationText(lgu)}</p>
                <label style={{ fontSize: 14, display: "flex", alignItems: "flex-start", gap: 6 }}>
                  <input type="checkbox" checked={declarationAccepted} onChange={(e) => setDeclarationAccepted(e.target.checked)} style={{ marginTop: 2 }} />
                  I have read and agree to the above.
                </label>
              </div>

              <button
                onClick={submitApplication}
                disabled={loading}
                style={{ ...actBtnStyle, ...primaryBtnStyle, marginTop: 8, ...(loading ? disabledBtnStyle : {}) }}
              >
                {loading ? "Submitting…" : "Submit application"}
              </button>
              <p style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>
                * required. If anything&rsquo;s missing, you&rsquo;ll see exactly what&rsquo;s missing right here after you submit.
              </p>
            </>
          ) : (
            <div style={{ ...cardStyle, background: "#f4f6fb", border: "none", marginTop: 20 }}>
              <p style={{ fontSize: 14, color: "#6b7280" }}>
                Fill in the required fields above (marked *) to continue to document uploads, your signature, and submission.
              </p>
              {missingRequiredFields.length > 0 && (
                <p style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>
                  Still needed: {missingRequiredFields.map(fieldLabel).join(", ")}.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {screen === "submitted" && submittedReference && (
        <>
          <Head title="Application submitted" sub={`Reference number ${submittedReference}`} />
          <div style={cardStyle}>
            <p style={{ fontSize: 15 }}>BPLO will review your submitted documents first. You will get an SMS the moment there is an update, no need to keep checking.</p>
          </div>
          <a href={`/status/${submittedReference}`} style={{ ...actBtnStyle, display: "inline-block", textDecoration: "none" }}>View application status</a>
        </>
      )}
    </div>
  );
}

/** LGU letterhead banner from the real form's header -- shown once, persistently, above every screen (not per-screen like Head below). Tax year is derived from the current date rather than hardcoded, so this doesn't need a manual edit every January. */
function LguBanner({ lgu }: { lgu: LguDisplay }) {
  const year = new Date().getFullYear();
  return (
    <div style={{ background: "#0C4DA2", color: "#fff", borderRadius: 12, padding: "18px 20px", marginBottom: 20, textAlign: "center" }}>
      <p style={{ fontSize: 15, margin: 0 }}>Republic of Philippines</p>
      {lgu.province && <p style={{ fontSize: 15, margin: 0 }}>Province of {lgu.province}</p>}
      <p style={{ fontSize: 15, margin: 0 }}>{lgu.displayName}</p>
      <p style={{ fontSize: 15, fontWeight: 700, margin: "2px 0 0", textTransform: "uppercase" }}>
        {lgu.bploOfficeName}
      </p>
      <div style={{ borderTop: "1px dashed rgba(255,255,255,0.55)", margin: "12px 0" }} />
      <p style={{ fontSize: 15, fontWeight: 700, margin: 0, textTransform: "uppercase" }}>Unified Application Form for Business Permit</p>
      <p style={{ fontSize: 15, fontWeight: 700, margin: "2px 0 0", textTransform: "uppercase" }}>Tax Year {year}</p>
    </div>
  );
}

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <p style={{ fontWeight: 500, fontSize: 18, margin: 0 }}>{title}</p>
      {sub && <p style={{ fontSize: 15, color: "#6b7280", marginTop: 4 }}>{sub}</p>}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 13, fontWeight: 600, color: "#6b7280", letterSpacing: 0.4, textTransform: "uppercase", margin: "20px 0 10px", borderTop: FIELD_BORDER, paddingTop: 14 }}>
      {children}
    </p>
  );
}

/**
 * `id` connects the visible label to its input via htmlFor -- previously
 * omitted everywhere, so every field's label was only ever positioned next
 * to its input, not programmatically associated with it (2026-08-20 audit,
 * critical accessibility finding: confirmed live that `input.labels.length`
 * was 0 on every field). Optional, since a couple of callers (the
 * checkbox-group fieldset, the signature pad) label themselves a different
 * way and don't pass one.
 */
function Field({ label, id, children }: { label: string; id?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12, flex: 1 }}>
      <label htmlFor={id} style={{ display: "block", fontSize: 14, color: "#6b7280", marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

/**
 * Type-to-filter dropdown (2026-08-19, project owner's own direct
 * report: "I can only type one letter") -- a plain native <select> with
 * ~220 Nature of Business options only supports the browser's own
 * built-in typeahead (jump to the first option starting with whatever
 * key was just pressed, resetting almost immediately), not a real
 * substring search. Kept as its own reusable FieldDescriptor kind
 * ("searchable-select") rather than a one-off hack tied to this specific
 * field, so applying it to another long list later (e.g. Barangay) is a
 * one-line change, not a rebuild.
 *
 * Deliberately still resolves to one exact string from `options` on
 * selection -- typing never becomes the stored value itself, matching
 * every other select-backed field in this form (application-form-logic.ts's
 * conditional rules pattern-match on exact option text). Clicking away or
 * pressing Escape without picking an option reverts the visible text back
 * to whatever was actually selected, so this can never end up in a state
 * where the displayed text doesn't match the real underlying value.
 */
function SearchableSelect({ id, value, onChange, options }: { id?: string; value: string; onChange: (v: string) => void; options: readonly string[] }) {
  // `query` intentionally only initializes from `value` once, at mount --
  // this component only ever mounts once the "form" screen is already
  // showing, by which point a returning applicant's profile (if any) has
  // already been merged into `value`, so there's no later external change
  // to sync. Every path that changes `value` after that point originates
  // from this component itself (select()/the outside-click and Escape
  // handlers below), and each one already sets `query` directly right
  // there -- an effect re-deriving query from value would just be a
  // second, redundant write, exactly what react-hooks/set-state-in-effect
  // flags.
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q === value.toLowerCase()) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [query, options, value]);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(value);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open, value]);

  function select(opt: string) {
    onChange(opt);
    setQuery(opt);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlighted]) select(filtered[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery(value);
    }
  }

  const listboxId = `${id ?? "searchable-select"}-listbox`;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-activedescendant={open && filtered[highlighted] ? `${listboxId}-${highlighted}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => setOpen(true)}
        // Selecting an option uses onMouseDown + preventDefault (below) so
        // the input never actually blurs during selection -- meaning a
        // second click on the (already-focused) input right after picking
        // something would never re-fire onFocus, and the dropdown would
        // stay stuck closed with no way to search again. onClick covers
        // exactly that case; onFocus alone covers tabbing/clicking in from
        // a genuinely different element. Found by driving a real click
        // sequence during verification, not by inspection.
        onClick={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Type to search…"
        autoComplete="off"
        style={inputStyle}
      />
      {open && (
        <div
          id={listboxId}
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 20,
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            maxHeight: 240,
            overflowY: "auto",
            background: "#fff",
            border: FIELD_BORDER,
            borderRadius: 8,
            boxShadow: "0 8px 20px rgba(0,0,0,0.1)",
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: "10px 12px", fontSize: 15, color: "#9ca3af" }}>No matches — try a different spelling.</div>
          ) : (
            filtered.map((opt, i) => (
              <div
                key={opt}
                id={`${listboxId}-${i}`}
                role="option"
                aria-selected={opt === value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(opt);
                }}
                onMouseEnter={() => setHighlighted(i)}
                style={{
                  padding: "9px 12px",
                  fontSize: 15,
                  cursor: "pointer",
                  background: i === highlighted ? "#f4f6fb" : "#fff",
                  color: opt === value ? "#0C447C" : "#1a1a2e",
                  fontWeight: opt === value ? 600 : 400,
                }}
              >
                {opt}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function OptCard({ title, desc, onClick }: { title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ textAlign: "left", border: FIELD_BORDER, borderRadius: 12, padding: "1rem", minHeight: 44, cursor: "pointer", flex: 1, minWidth: 200, background: "#fff", font: "inherit", color: "inherit" }}>
      <p style={{ fontWeight: 500, fontSize: 16, marginBottom: 6 }}>{title}</p>
      <p style={{ fontSize: 14, color: "#6b7280" }}>{desc}</p>
    </button>
  );
}

/**
 * Plain-canvas signature capture -- no drawing library, just pointer
 * events + toBlob(). Matches the source form's (optional, per fields.json)
 * signature field.
 *
 * Auto-saves ~900ms after the pen lifts, instead of requiring the
 * "Save signature" click every time -- a signature is usually drawn in
 * several strokes (lifting between letters), so this can't just save on
 * every pointer-up or it'd re-upload a half-finished signature; it waits
 * for a pause long enough to mean "done," and resets that timer the
 * moment a new stroke starts. The manual button stays too, both because
 * it doubles as an immediate "no, save it now" option and because
 * needing it in the first place is what surfaced this.
 */
function SignaturePad({ onSave, saving, saved }: { onSave: (file: File) => void; saving: boolean; saved: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const hasStrokesRef = useRef(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearAutoSaveTimer() {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
  }

  // The canvas's internal drawing resolution (560x120, set via the width/
  // height attributes below) is fixed, but it's displayed stretched to fit
  // the container (style={{ width: "100%" }}) -- on a phone narrower than
  // 560px this scales the box down, so a touch at the right edge of the
  // *visible* pad was landing partway across the *internal* canvas,
  // visibly compressing the drawn signature into the left portion of the
  // image (2026-08-20 audit finding, confirmed by measuring a real 375px
  // viewport). Scaling clientX/clientY by the canvas's own internal-to-
  // displayed size ratio keeps the drawn point under the actual touch
  // point regardless of how much the box has been stretched or shrunk.
  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }
  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = true;
    lastPoint.current = getPos(e);
    clearAutoSaveTimer(); // a new stroke starting means the signature isn't finished yet
  }
  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !lastPoint.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e);
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPoint.current = pos;
    hasStrokesRef.current = true;
  }
  function handlePointerUp() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPoint.current = null;
    if (hasStrokesRef.current) {
      clearAutoSaveTimer();
      autoSaveTimer.current = setTimeout(save, 900);
    }
  }
  function clear() {
    clearAutoSaveTimer();
    hasStrokesRef.current = false;
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }
  function save() {
    clearAutoSaveTimer();
    canvasRef.current?.toBlob((blob) => {
      if (blob) onSave(new File([blob], "signature.png", { type: "image/png" }));
    }, "image/png");
  }

  return (
    <Field label={`Signature${saved ? " ✓ saved" : ""}`}>
      <canvas
        ref={canvasRef}
        width={560}
        height={120}
        style={{ width: "100%", height: 120, border: FIELD_BORDER, borderRadius: 8, background: "#fff", touchAction: "none" }}
        role="img"
        aria-label="Signature drawing pad. Draw your signature using your finger, stylus, or mouse."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
        <button type="button" onClick={clear} style={actBtnStyle}>Clear</button>
        <button type="button" onClick={save} disabled={saving} style={{ ...actBtnStyle, ...(saving ? disabledBtnStyle : {}) }}>
          {saving ? "Saving…" : "Save now"}
        </button>
        {!saving && !saved && <span style={{ fontSize: 13, color: "#6b7280" }}>Saves automatically a moment after you finish signing.</span>}
      </div>
    </Field>
  );
}

// Border color darkened from the original #e5e7eb (contrast ~1.2:1 against
// white -- well under WCAG's 3:1 minimum for UI boundaries) to #c7ced8
// (~2.9:1, comfortably readable) and widened from 0.5px to 1px, per the
// 2026-08-20 audit's finding that fields/cards read as barely-bounded on a
// 1x-DPR budget phone in bright light. Touch targets (input/button height,
// button padding) raised toward the ~44px comfortable minimum for the same
// audit pass -- this app's primary audience is on older/cheaper phones.
const FIELD_BORDER = "1px solid #c7ced8";
const backBtnStyle: React.CSSProperties = { fontSize: 15, padding: "10px 16px", minHeight: 44, borderRadius: 8, border: FIELD_BORDER, background: "#fff", cursor: "pointer", marginBottom: 16 };
const actBtnStyle: React.CSSProperties = { fontSize: 15, padding: "10px 16px", minHeight: 44, borderRadius: 8, border: FIELD_BORDER, background: "#fff", cursor: "pointer" };
const primaryBtnStyle: React.CSSProperties = { background: "#0C447C", color: "#fff", borderColor: "#0C447C", fontWeight: 600 };
/** actBtnStyle/primaryBtnStyle have no disabled variant on their own -- a
 * disabled <button> looks identical to an enabled one with plain inline
 * styles, which is exactly what made "Submit application" look broken
 * (it was silently disabled, not unresponsive -- CLAUDE.md's write-up of
 * this fix has the full story). Spread this in last whenever a button's
 * `disabled` prop can be true. */
const disabledBtnStyle: React.CSSProperties = { opacity: 0.45, cursor: "not-allowed" };
const inputStyle: React.CSSProperties = { width: "100%", height: 46, border: FIELD_BORDER, borderRadius: 8, padding: "0 12px", fontSize: 16, background: "#fff", color: "#1a1a2e" };
const cardStyle: React.CSSProperties = { border: FIELD_BORDER, borderRadius: 8, padding: 12, marginBottom: "1rem" };
const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "12px 12px", minHeight: 44, borderBottom: FIELD_BORDER, cursor: "pointer" };
