"use client";

import { useRef, useState } from "react";
import {
  NATURE_OF_BUSINESS_OPTIONS, BARANGAY_OPTIONS, BUSINESS_TAX_PAYMENT_OPTIONS, ORGANIZATION_TYPE_OPTIONS, REGISTRATION_AUTHORITY_OPTIONS,
  TAX_TYPE_OPTIONS, GENDER_OPTIONS, BUSINESS_ACTIVITY_OPTIONS, OPERATION_ADDRESS_OPTIONS, PREMISES_OWNERSHIP_OPTIONS,
  YES_NO_OPTIONS, BARANGAY_CLEARANCE_OPTIONS,
} from "@/lib/san-miguel-form-options";
import { computeVisibleFields, REQUIRED_FIELDS, type FieldKey } from "@/lib/application-form-logic";

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
 *   1. A "sign in with your phone instead" link on the license-number
 *      screen, for a returning owner's second-and-later renewal ("every
 *      renewal after this first one works purely on phone-number OTP, no
 *      License Number needed").
 *   2. A business-picker step when a returning owner chooses to renew and
 *      turns out to have more than one business on file.
 */

type Screen =
  | "landing"
  | "renewal_license"
  | "renewal_confirm"
  | "phone"
  | "otp"
  | "identity"
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

type FieldDescriptor =
  | { key: FieldKey; label: string; kind: "text" | "number" }
  | { key: FieldKey; label: string; kind: "select"; options: readonly string[] }
  | { key: FieldKey; label: string; kind: "checkboxgroup"; options: readonly string[] };

const BUSINESS_INFO_FIELDS: FieldDescriptor[] = [
  { key: "businessName", label: "Business name", kind: "text" },
  { key: "businessTaxPayment", label: "Business tax payment", kind: "select", options: BUSINESS_TAX_PAYMENT_OPTIONS },
  { key: "natureOfBusiness", label: "Nature of business", kind: "select", options: NATURE_OF_BUSINESS_OPTIONS },
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

const DECLARATION_TEXT =
  "I DECLARE UNDER PENALTY OF PERJURY that all information in this application are true and correct based on my " +
  "personal knowledge and authentic records submitted to the BPLO San Miguel Bulacan. Any false or misleading " +
  "information supplied, or production of fake/falsified documents shall be grounds for appropriate legal action " +
  "against me and automatically revokes the permit. I hereby agree that all personal data (as defined under the " +
  "Data Privacy Law of 2012 and its implementing Rules and Regulations) and account transactions information or " +
  "records with the City/Municipal Government may be processed, profiled or shared to requesting or for the " +
  "purpose of any court legal process, examination, inquiry, and audit or investigation or any authority.";

export default function ApplyPage() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [path, setPath] = useState<"new" | "renewal" | null>(null);
  const [phoneSigninMode, setPhoneSigninMode] = useState(false);

  const [licenseInput, setLicenseInput] = useState("");
  const [matchedLegacy, setMatchedLegacy] = useState<LegacyMatch | null>(null);
  const [noMatch, setNoMatch] = useState(false);

  const [phone, setPhone] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  const [matched, setMatched] = useState(false);
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

  function startOver() {
    setScreen("landing");
    setPath(null);
    setPhoneSigninMode(false);
    setLicenseInput("");
    setMatchedLegacy(null);
    setNoMatch(false);
    setPhone("");
    setOtpInput("");
    setOtpSent(false);
    setMatched(false);
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

  async function lookupLicense() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/applicant/lookup-license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenseNumber: licenseInput.trim() }),
      });
      const data = await res.json();
      if (data.found) {
        setMatchedLegacy(data.business);
        setNoMatch(false);
      } else {
        setMatchedLegacy(null);
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
        setError(data.error === "too_soon" ? "Please wait a bit before requesting another code." : "Could not send a code to that number. Check it and try again.");
        return;
      }
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
        }),
      });
      if (!res.ok) {
        setError("That code didn't work — check it and try again, or request a new one.");
        return;
      }
      const data = await res.json();
      setMatched(data.matched);
      setBusinessCount(data.businessCount);
      if (data.ownerName) {
        const [first, ...rest] = String(data.ownerName).split(" ");
        setFirstName(first ?? "");
        setLastName(rest.join(" "));
      }

      if (path === "renewal" && matchedLegacy) {
        // Legacy claim just completed -- go straight to the form for that business.
        applyProfile(matchedLegacy);
        setScreen(data.needsIdentity ? "identity" : "form");
      } else if (path === "renewal" && phoneSigninMode) {
        // Returning owner signing in by phone for a later renewal.
        if (!data.matched) {
          setError("We don't have an account under this number yet. If you have an existing business, please use your License Number instead.");
          setScreen("renewal_license");
          return;
        }
        const businesses = await fetchMyBusinesses();
        if (data.needsIdentity) {
          setScreen("identity");
        } else if (businesses.length === 1) {
          applyProfile(businesses[0]);
          setScreen("form");
        } else {
          setScreen("business_picker");
        }
      } else if (data.needsIdentity) {
        setScreen("identity");
      } else if (data.matched) {
        setScreen("owner_match");
      } else {
        setScreen("form");
      }
    } finally {
      setLoading(false);
    }
  }

  async function submitIdentity() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/applicant/update-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), email: emailInput.trim(), gender: genderInput || undefined }),
      });
      if (!res.ok) {
        setError("Please check your name and email address.");
        return;
      }
      if (path === "renewal" && phoneSigninMode) {
        const businesses = myBusinesses ?? (await fetchMyBusinesses());
        if (businesses.length === 1) {
          applyProfile(businesses[0]);
          setScreen("form");
        } else {
          setScreen("business_picker");
        }
      } else if (matched) {
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
      const fd = new FormData();
      fd.append("file", file);
      fd.append("documentType", label);
      const res = await fetch("/api/applicant/upload-document", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error === "file_too_large" ? "That file is too large (10MB max)." : "Could not upload that file — try a PDF or image under 10MB.");
        return;
      }
      const data = await res.json();
      setDocuments((prev) => ({ ...prev, [key]: data.documentId }));
    } finally {
      setUploadingDoc(null);
    }
  }

  function buildVisibleValues(): Partial<Record<FieldKey, unknown>> {
    return {
      applicationType: path === "new" ? "New" : path === "renewal" ? "Renewal" : "",
      ...form,
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
          businessName: form.businessName,
          natureOfBusiness: form.natureOfBusiness,
          organizationType: form.organizationType,
          businessTaxPayment: form.businessTaxPayment || undefined,
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
            ? `Please fill in: ${(data.fields ?? []).join(", ")}`
            : data.error === "declaration_not_accepted"
              ? "Please accept the declaration before submitting."
              : "Something went wrong submitting your application. Please try again."
        );
        return;
      }
      const data = await res.json();
      setSubmittedReference(data.referenceNumber);
      setScreen("submitted");
    } finally {
      setLoading(false);
    }
  }

  const visibleFields = computeVisibleFields(buildVisibleValues());

  function renderField(fd: FieldDescriptor) {
    if (!visibleFields.has(fd.key)) return null;
    const required = REQUIRED_FIELDS.has(fd.key);
    const label = fd.label + (required ? " *" : "");

    if (fd.kind === "checkboxgroup") {
      const current = (form[fd.key as keyof FormState] as string[]) ?? [];
      return (
        <Field key={fd.key} label={label}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {fd.options.map((opt) => (
              <label key={opt} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  type="checkbox"
                  checked={current.includes(opt)}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      [fd.key]: e.target.checked ? [...current, opt] : current.filter((o) => o !== opt),
                    }))
                  }
                />
                {opt}
              </label>
            ))}
          </div>
        </Field>
      );
    }

    const value = (form[fd.key as keyof FormState] as string) ?? "";
    if (fd.kind === "select") {
      return (
        <Field key={fd.key} label={label}>
          <select value={value} onChange={(e) => setForm((f) => ({ ...f, [fd.key]: e.target.value }))} style={inputStyle}>
            <option value="">Select one</option>
            {fd.options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </Field>
      );
    }
    return (
      <Field key={fd.key} label={label}>
        <input
          type={fd.kind === "number" ? "number" : "text"}
          value={value}
          onChange={(e) => setForm((f) => ({ ...f, [fd.key]: e.target.value }))}
          style={inputStyle}
        />
      </Field>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "32px auto", background: "#fff", borderRadius: 16, padding: 24, border: "0.5px solid #e5e7eb", fontFamily: "-apple-system, 'Segoe UI', Arial, sans-serif", color: "#1a1a2e" }}>
      {screen !== "landing" && screen !== "submitted" && (
        <button onClick={startOver} style={backBtnStyle}>Start over</button>
      )}
      {error && (
        <div style={{ background: "#FCEBEB", color: "#791F1F", fontSize: 12, padding: "8px 12px", borderRadius: 8, marginBottom: 16 }}>{error}</div>
      )}

      {screen === "landing" && (
        <>
          <Head title="MuniServe" sub="San Miguel, Bulacan · Business permit application" />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <OptCard title="New business" desc="First time applying for a permit with this business." onClick={() => { setPath("new"); setPhoneSigninMode(false); setScreen("phone"); }} />
            <OptCard title="Renew existing permit" desc="Already have a business registered with the municipality." onClick={() => { setPath("renewal"); setPhoneSigninMode(false); setScreen("renewal_license"); }} />
          </div>
        </>
      )}

      {screen === "renewal_license" && (
        <>
          <Head title="Find your business" sub="Enter the License Number printed on your current permit or last official receipt." />
          <Field label="License number">
            <input value={licenseInput} onChange={(e) => setLicenseInput(e.target.value)} placeholder="e.g. 7094956" style={inputStyle} />
          </Field>
          <button onClick={lookupLicense} disabled={loading || !licenseInput.trim()} style={actBtnStyle}>Continue</button>
          <p style={{ fontSize: 11, color: "#6b7280", marginTop: 16 }}>
            Already claimed your business before?{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); setPhoneSigninMode(true); setScreen("phone"); }} style={{ color: "#0C447C" }}>
              Sign in with your phone instead
            </a>.
          </p>
        </>
      )}

      {screen === "renewal_confirm" && (
        noMatch ? (
          <>
            <Head title="No match found" sub="We could not find a business with that License Number. Please check the number or visit the BPLO counter for assistance." />
            <button onClick={() => setScreen("renewal_license")} style={actBtnStyle}>Try again</button>
          </>
        ) : matchedLegacy && (
          <>
            <Head title="Is this your business?" sub="We found a record under this License Number. Confirm before continuing." />
            <div style={cardStyle}>
              <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{matchedLegacy.businessName}</p>
              <p style={{ fontSize: 12, color: "#6b7280" }}>
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
          <Field label="Mobile number">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09XX XXX XXXX" style={inputStyle} />
          </Field>
          <button onClick={sendOtp} disabled={loading || !phone.trim()} style={actBtnStyle}>{loading ? "Sending…" : "Send code"}</button>
        </>
      )}

      {screen === "otp" && (
        <>
          <Head title="Enter the code" sub={`We sent a 6-digit code to ${phone}.`} />
          <Field label="Verification code">
            <input value={otpInput} onChange={(e) => setOtpInput(e.target.value)} placeholder="6-digit code" style={inputStyle} />
          </Field>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={verifyOtp} disabled={loading || otpInput.trim().length !== 6} style={actBtnStyle}>Verify</button>
            <button onClick={sendOtp} disabled={loading} style={actBtnStyle}>Resend code</button>
          </div>
          {otpSent && <p style={{ fontSize: 11, color: "#6b7280", marginTop: 10 }}>Code sent via SMS.</p>}
        </>
      )}

      {screen === "identity" && (
        <>
          <Head title="A few details about you" sub="This is how BPLO and department staff will identify you as the owner." />
          <div style={{ display: "flex", gap: 8 }}>
            <Field label="First name"><input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Juan" style={inputStyle} /></Field>
            <Field label="Last name"><input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Dela Cruz" style={inputStyle} /></Field>
          </div>
          <Field label="Email"><input value={emailInput} onChange={(e) => setEmailInput(e.target.value)} placeholder="juan@example.com" style={inputStyle} /></Field>
          <Field label="Gender (optional)">
            <select value={genderInput} onChange={(e) => setGenderInput(e.target.value)} style={inputStyle}>
              <option value="">Prefer not to say</option>
              {GENDER_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <button onClick={submitIdentity} disabled={loading || firstName.trim().length < 1 || lastName.trim().length < 1 || !emailInput.trim()} style={actBtnStyle}>Continue</button>
        </>
      )}

      {screen === "owner_match" && (
        <>
          <Head title="We found an account" sub="A profile already exists for this mobile number." />
          <div style={cardStyle}>
            <p style={{ fontSize: 13, fontWeight: 500 }}>Welcome back</p>
            <p style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{businessCount} business{businessCount === 1 ? "" : "es"} currently on file</p>
          </div>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>This new business will be added to your existing profile, no separate account needed.</p>
          <button onClick={() => setScreen("form")} style={actBtnStyle}>Continue</button>
        </>
      )}

      {screen === "business_picker" && myBusinesses && (
        <>
          <Head title="Which business are you renewing?" sub="Select one to continue." />
          <div style={{ border: "0.5px solid #e5e7eb", borderRadius: 8 }}>
            {myBusinesses.map((b) => (
              <button key={b.id} onClick={() => pickBusiness(b)} style={{ ...rowStyle, width: "100%", background: "#fff", font: "inherit", color: "inherit", textAlign: "left" }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{b.businessName}</p>
                  <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>{b.barangay} · {b.natureOfBusiness}</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {screen === "form" && (
        <>
          <Head title="Business permit application" sub={`${path === "renewal" ? "Renewal" : "New application"} · San Miguel, Bulacan`} />
          {path === "renewal" && (
            <div style={{ ...cardStyle, background: "#f4f6fb", border: "none" }}>
              <p style={{ fontSize: 12, color: "#6b7280" }}>Pre-filled from your existing record, update anything that has changed.</p>
            </div>
          )}

          <SectionHeading>Business information & registration</SectionHeading>
          {BUSINESS_INFO_FIELDS.map(renderField)}

          <SectionHeading>Main office address</SectionHeading>
          {ADDRESS_FIELDS.map(renderField)}

          <SectionHeading>Business operation</SectionHeading>
          {BUSINESS_OPERATION_FIELDS.map(renderField)}

          <SectionHeading>Documents to submit</SectionHeading>
          {DOCUMENT_FIELDS.filter((d) => visibleFields.has(d.key)).map((d) => (
            <div key={d.key} style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", marginBottom: 6 }}>
              <span style={{ fontSize: 12 }}>
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
            <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>{DECLARATION_TEXT}</p>
            <label style={{ fontSize: 12, display: "flex", alignItems: "flex-start", gap: 6 }}>
              <input type="checkbox" checked={declarationAccepted} onChange={(e) => setDeclarationAccepted(e.target.checked)} style={{ marginTop: 2 }} />
              I have read and agree to the above.
            </label>
          </div>

          <button
            onClick={submitApplication}
            disabled={loading || !form.businessName || !form.natureOfBusiness || !declarationAccepted}
            style={{ ...actBtnStyle, marginTop: 8 }}
          >
            {loading ? "Submitting…" : "Submit application"}
          </button>
        </>
      )}

      {screen === "submitted" && submittedReference && (
        <>
          <Head title="Application submitted" sub={`Reference number ${submittedReference}`} />
          <div style={cardStyle}>
            <p style={{ fontSize: 13 }}>BPLO will review your submitted documents first. You will get an SMS the moment there is an update, no need to keep checking.</p>
          </div>
          <a href={`/status/${submittedReference}`} style={{ ...actBtnStyle, display: "inline-block", textDecoration: "none" }}>View application status</a>
        </>
      )}
    </div>
  );
}

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <p style={{ fontWeight: 500, fontSize: 16, margin: 0 }}>{title}</p>
      {sub && <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{sub}</p>}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", letterSpacing: 0.4, textTransform: "uppercase", margin: "20px 0 10px", borderTop: "0.5px solid #e5e7eb", paddingTop: 14 }}>
      {children}
    </p>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12, flex: 1 }}>
      <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function OptCard({ title, desc, onClick }: { title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ textAlign: "left", border: "0.5px solid #e5e7eb", borderRadius: 12, padding: "1rem", cursor: "pointer", flex: 1, minWidth: 200, background: "#fff", font: "inherit", color: "inherit" }}>
      <p style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>{title}</p>
      <p style={{ fontSize: 12, color: "#6b7280" }}>{desc}</p>
    </button>
  );
}

/** Plain-canvas signature capture -- no drawing library, just pointer events + toBlob(). Matches the source form's (optional, per fields.json) signature field. */
function SignaturePad({ onSave, saving, saved }: { onSave: (file: File) => void; saving: boolean; saved: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = true;
    lastPoint.current = getPos(e);
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
  }
  function handlePointerUp() {
    drawingRef.current = false;
    lastPoint.current = null;
  }
  function clear() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }
  function save() {
    canvasRef.current?.toBlob((blob) => {
      if (blob) onSave(new File([blob], "signature.png", { type: "image/png" }));
    }, "image/png");
  }

  return (
    <Field label={`Signature${saved ? " ✓" : ""}`}>
      <canvas
        ref={canvasRef}
        width={560}
        height={120}
        style={{ width: "100%", height: 120, border: "0.5px solid #e5e7eb", borderRadius: 8, background: "#fff", touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button type="button" onClick={clear} style={actBtnStyle}>Clear</button>
        <button type="button" onClick={save} disabled={saving} style={actBtnStyle}>{saving ? "Saving…" : "Save signature"}</button>
      </div>
    </Field>
  );
}

const backBtnStyle: React.CSSProperties = { fontSize: 12, padding: "6px 10px", borderRadius: 8, border: "0.5px solid #e5e7eb", background: "#fff", cursor: "pointer", marginBottom: 16 };
const actBtnStyle: React.CSSProperties = { fontSize: 12, padding: "6px 10px", borderRadius: 8, border: "0.5px solid #e5e7eb", background: "#fff", cursor: "pointer" };
const inputStyle: React.CSSProperties = { width: "100%", height: 36, border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "0 10px", fontSize: 13, background: "#fff", color: "#1a1a2e" };
const cardStyle: React.CSSProperties = { border: "0.5px solid #e5e7eb", borderRadius: 8, padding: 12, marginBottom: "1rem" };
const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderBottom: "0.5px solid #e5e7eb", cursor: "pointer" };
