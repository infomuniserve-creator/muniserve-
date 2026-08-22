import { getApplicantOwnerId } from "@/lib/applicant-session";
import { getCedulaIncludedOnline, isLguPaused, resolveLguId } from "@/lib/lgu";
import { notifyStaffByRole } from "@/lib/notifications";
import { logAuditEvent } from "@/lib/audit-log";
import { createServiceClient } from "@/lib/supabase/service";
import { REQUIRED_FIELDS, isFieldCurrentlyRequired, type FieldKey } from "@/lib/application-form-logic";
import { NextResponse } from "next/server";

/** Documents are uploaded ahead of submit (via /upload-document), then referenced here by id -- one id per real document field, matching the source form's isMultipleFile: false on every upload field. */
type DocumentFieldKey =
  | "cedulaDoc" | "govIdDoc" | "dtiSecCdaDoc" | "leaseContractDoc" | "vicinityMapDoc"
  | "barangayClearanceDoc" | "taxIncentivesDoc" | "swornStatementDoc" | "signatureDoc";

type SubmitBody = {
  applicationType: "new" | "renewal";
  businessId?: string;

  // Owner / Representative Info -- now collected on every submission (see
  // application-form-logic.ts's Owner / Representative Info fields), not
  // just once via the old identity screen. Written back to the owners row
  // below, in addition to being validated as part of this application.
  firstName?: string;
  lastName?: string;
  email?: string;
  gender?: string;

  // Business Info & Registration
  businessName: string;
  natureOfBusiness: string;
  organizationType: string;
  businessTaxPayment?: string;
  registrationAuthority?: string;
  registrationNo?: string;
  tin?: string;
  taxType?: string;
  tradeName?: string;
  capitalInvestment?: number;
  grossSales?: number;

  // Main Office Address
  unitStreet?: string;
  cityTown?: string;
  barangay?: string;
  province?: string;
  zipCode?: string;

  // Business Operation
  businessActivity?: string[];
  deliveryVehicleCount?: string;
  operationAddressSame?: string;
  operationAddress?: string;
  businessAreaSqm?: string;
  totalFloorAreaSqm?: string;
  secondaryBusinessActivity?: string;
  premisesOwnership?: string;
  taxDeclarationNo?: string;
  monthlyRent?: string;
  lessorName?: string;
  lessorContactNo?: string;
  lessorAddress?: string;
  hasEmployees?: string;
  maleEmployeeCount?: number;
  femaleEmployeeCount?: number;
  employeesResidingInLguCount?: number;
  hasBarangayClearance?: string;
  hasTaxIncentives?: string;

  // Nature-of-business-conditional cluster
  billiardTableCount?: number;
  lodgerCount?: number;
  landAreaHectares?: number;
  guardPostCount?: number;
  warehouseFloorAreaSqm?: number;
  seatingCapacity?: number;
  isAircon?: string;         // "Yes" / "No"
  isBranchOffice?: string;   // "Yes" / "No"
  animalCount?: number;

  declarationAccepted: boolean;
  documents: Partial<Record<DocumentFieldKey, string>>;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Creates the application (and, for a genuinely new business, the
 * businesses row -- rule #2: renewal NEVER creates a new owner or a new
 * business record, it always resolves to an existing businesses row).
 * Starts at status = 'pending_bplo_initial' -- the state machine's
 * 'submitted' value exists for completeness but there's nothing that
 * needs to happen between "applicant clicks submit" and "it's in BPLO's
 * queue" for a document-based review, so this skips straight there.
 * Fee computation and department fan-out are later build-order steps --
 * this route only captures the submission itself.
 *
 * Field set and required-ness now mirror reference/official-application-
 * form/ (the real, currently-live BPLO intake form) instead of the smaller
 * approximation this route started with -- see application-form-logic.ts
 * for the shared show/hide + required-field rules this validates against.
 */
export async function POST(request: Request) {
  const ownerId = await getApplicantOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as SubmitBody | null;
  if (!body || !body.applicationType) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (!body.declarationAccepted) {
    return NextResponse.json({ error: "declaration_not_accepted" }, { status: 400 });
  }

  const firstName = String(body.firstName ?? "").trim();
  const lastName = String(body.lastName ?? "").trim();
  const email = String(body.email ?? "").trim();
  const gender = body.gender ? String(body.gender).trim() : null;

  // Resolved up front (moved ahead of the required-fields check below) --
  // CEDULA's upload requirement depends on this LGU's own setting
  // (Settings, CLAUDE.md follow-up), so it has to be known before deciding
  // what's actually required, not just before the rest of the writes.
  const supabase = createServiceClient();
  const lguId = await resolveLguId(request.headers.get("host"));
  const cedulaIncludedOnline = await getCedulaIncludedOnline(supabase, lguId);

  const values: Partial<Record<FieldKey, unknown>> = {
    applicationType: body.applicationType === "new" ? "New" : "Renewal",
    firstName,
    lastName,
    email,
    gender: gender ?? undefined,
    // "phone" is required per REQUIRED_FIELDS, but it's the OTP-verified
    // session identity, not a value this route accepts from the client (see
    // CLAUDE.md 7d/7h) -- ownerId's existence already guarantees a real
    // phone is on file, so this is just a non-blank placeholder to satisfy
    // the shared required-field check, not a value that gets written anywhere.
    phone: "verified",
    businessName: body.businessName,
    natureOfBusiness: body.natureOfBusiness,
    organizationType: body.organizationType,
    // A New business always pays the full annual Business Tax -- never
    // trust the client's own value for this, since the applicant form's
    // lock is only a UI convenience (2026-08-19). Only Renewal keeps
    // whatever the applicant actually picked.
    businessTaxPayment: body.applicationType === "new" ? "Annual" : body.businessTaxPayment,
    registrationAuthority: body.registrationAuthority,
    registrationNo: body.registrationNo,
    tin: body.tin,
    taxType: body.taxType,
    capitalInvestment: body.capitalInvestment,
    grossSales: body.grossSales,
    unitStreet: body.unitStreet,
    cityTown: body.cityTown,
    province: body.province,
    zipCode: body.zipCode,
    businessActivity: body.businessActivity?.length ? body.businessActivity : undefined,
    operationAddressSame: body.operationAddressSame,
    operationAddress: body.operationAddress,
    businessAreaSqm: body.businessAreaSqm,
    totalFloorAreaSqm: body.totalFloorAreaSqm,
    premisesOwnership: body.premisesOwnership,
    taxDeclarationNo: body.taxDeclarationNo,
    monthlyRent: body.monthlyRent,
    lessorName: body.lessorName,
    lessorContactNo: body.lessorContactNo,
    lessorAddress: body.lessorAddress,
    hasEmployees: body.hasEmployees,
    maleEmployeeCount: body.maleEmployeeCount,
    femaleEmployeeCount: body.femaleEmployeeCount,
    employeesResidingInLguCount: body.employeesResidingInLguCount,
    hasBarangayClearance: body.hasBarangayClearance,
    hasTaxIncentives: body.hasTaxIncentives,
    billiardTableCount: body.billiardTableCount,
    lodgerCount: body.lodgerCount,
    landAreaHectares: body.landAreaHectares,
    guardPostCount: body.guardPostCount,
    warehouseFloorAreaSqm: body.warehouseFloorAreaSqm,
    seatingCapacity: body.seatingCapacity,
    isAircon: body.isAircon,
    isBranchOffice: body.isBranchOffice,
    animalCount: body.animalCount,
    // Document fields: "value" is the uploaded document's id, or undefined if not uploaded yet.
    cedulaDoc: body.documents?.cedulaDoc,
    govIdDoc: body.documents?.govIdDoc,
    dtiSecCdaDoc: body.documents?.dtiSecCdaDoc,
    leaseContractDoc: body.documents?.leaseContractDoc,
    vicinityMapDoc: body.documents?.vicinityMapDoc,
    barangayClearanceDoc: body.documents?.barangayClearanceDoc,
    taxIncentivesDoc: body.documents?.taxIncentivesDoc,
    swornStatementDoc: body.documents?.swornStatementDoc,
  };

  const missing = [...REQUIRED_FIELDS].filter(
    (field) =>
      field !== "declarationAccepted" &&
      !(field === "cedulaDoc" && cedulaIncludedOnline) &&
      isFieldCurrentlyRequired(field, values) &&
      isBlank(values[field])
  );
  if (missing.length > 0) {
    return NextResponse.json({ error: "missing_required_fields", fields: missing }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  // Every submission can correct a typo'd name/email or update gender --
  // this is now the only place that writes to it (the old standalone
  // "update-name" endpoint/identity screen is gone, see CLAUDE.md 7h).
  const { error: ownerUpdateError } = await supabase
    .from("owners")
    .update({ full_name: `${firstName} ${lastName}`, email, gender })
    .eq("id", ownerId);
  if (ownerUpdateError) {
    return NextResponse.json({ error: "owner_update_failed" }, { status: 500 });
  }

  // Defense in depth (CLAUDE.md 7o follow-up, migration 0020): apply/
  // page.tsx already hides the whole wizard when paused, but a tab
  // opened before the pause, or a direct call to this route, must not be
  // able to slip a real application through anyway.
  if (await isLguPaused(lguId)) {
    return NextResponse.json({ error: "lgu_paused" }, { status: 403 });
  }

  const year = new Date().getFullYear();

  const businessColumns = {
    business_name: body.businessName,
    nature_of_business: body.natureOfBusiness,
    organization_type: body.organizationType ?? null,
    business_tax_payment: (values.businessTaxPayment as string | undefined) ?? null,
    registration_authority: body.registrationAuthority ?? null,
    registration_no: body.registrationNo ?? null,
    tin: body.tin ?? null,
    tax_type: body.taxType ?? null,
    trade_name: body.tradeName ?? null,
    unit_street: body.unitStreet ?? null,
    city_town: body.cityTown ?? null,
    barangay: body.barangay ?? null,
    province: body.province ?? null,
    zip_code: body.zipCode ?? null,
    business_activity: body.businessActivity?.length ? body.businessActivity : null,
    delivery_vehicle_count: body.deliveryVehicleCount ?? null,
    operation_address_different: body.operationAddressSame === "Business Operation is in Different Address",
    operation_address: body.operationAddress ?? null,
    business_area_sqm: body.businessAreaSqm ?? null,
    total_floor_area_sqm: body.totalFloorAreaSqm ?? null,
    secondary_business_activity: body.secondaryBusinessActivity ?? null,
    premises_ownership: body.premisesOwnership ?? null,
    tax_declaration_no: body.taxDeclarationNo ?? null,
    monthly_rent: body.monthlyRent ?? null,
    lessor_name: body.lessorName ?? null,
    lessor_contact_no: body.lessorContactNo ?? null,
    lessor_address: body.lessorAddress ?? null,
    has_employees: yesNoToBoolean(body.hasEmployees),
    male_employee_count: body.maleEmployeeCount ?? null,
    female_employee_count: body.femaleEmployeeCount ?? null,
    employees_residing_in_lgu_count: body.employeesResidingInLguCount ?? null,
    has_barangay_clearance: body.hasBarangayClearance ?? null,
    has_tax_incentives: yesNoToBoolean(body.hasTaxIncentives),
    billiard_table_count: body.billiardTableCount ?? null,
    lodger_count: body.lodgerCount ?? null,
    land_area_hectares: body.landAreaHectares ?? null,
    guard_post_count: body.guardPostCount ?? null,
    warehouse_floor_area_sqm: body.warehouseFloorAreaSqm ?? null,
    seating_capacity: body.seatingCapacity ?? null,
    is_aircon: yesNoToBoolean(body.isAircon),
    is_branch_office: yesNoToBoolean(body.isBranchOffice),
    animal_count: body.animalCount ?? null,
  };

  let businessId: string;

  if (body.applicationType === "renewal") {
    if (!body.businessId) {
      return NextResponse.json({ error: "missing_business_id" }, { status: 400 });
    }
    const { data: business, error: fetchError } = await supabase
      .from("businesses")
      .select("id, gross_sales_history")
      .eq("id", body.businessId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (fetchError || !business) {
      return NextResponse.json({ error: "business_not_found_or_not_yours" }, { status: 403 });
    }

    const history = (business.gross_sales_history as Record<string, number> | null) ?? {};
    if (body.grossSales != null) history[String(year)] = body.grossSales;

    const { error: updateError } = await supabase
      .from("businesses")
      .update({ ...businessColumns, gross_sales_history: history })
      .eq("id", body.businessId);
    if (updateError) {
      return NextResponse.json({ error: "business_update_failed" }, { status: 500 });
    }
    businessId = body.businessId;
  } else {
    const { data: newBusiness, error: createError } = await supabase
      .from("businesses")
      .insert({
        ...businessColumns,
        lgu_id: lguId,
        owner_id: ownerId,
        is_legacy_unclaimed: false,
        is_active: true,
      })
      .select("id")
      .single();
    if (createError || !newBusiness) {
      return NextResponse.json({ error: "business_create_failed" }, { status: 500 });
    }
    businessId = newBusiness.id;
  }

  const { data: referenceNumber, error: refError } = await supabase.rpc(
    "generate_application_reference",
    { p_lgu_id: lguId, p_year: year }
  );
  if (refError || !referenceNumber) {
    return NextResponse.json({ error: "reference_generation_failed" }, { status: 500 });
  }

  // Only the genuinely per-submission financial figures live in form_inputs,
  // per fee_rules.basis_field's existing convention -- everything else
  // durable about the business lives on the businesses row updated/created
  // above.
  const formInputs = {
    capital_investment: body.applicationType === "new" ? body.capitalInvestment ?? null : null,
    gross_sales: body.applicationType === "renewal" ? body.grossSales ?? null : null,
  };

  // Snapshot of exactly what was submitted (migration 0036) -- `values`
  // already has everything, minus the doc-id fields (not human-readable,
  // application-form-pdf.ts lists actual documents separately) and
  // `phone` (the "verified" placeholder set above, not a real value --
  // the applicant's real phone is always read live from `owners` instead,
  // same reasoning CLAUDE.md 7d/7h already applied to this exact field).
  const {
    phone: _phone, cedulaDoc: _cedulaDoc, govIdDoc: _govIdDoc, dtiSecCdaDoc: _dtiSecCdaDoc,
    leaseContractDoc: _leaseContractDoc, vicinityMapDoc: _vicinityMapDoc, barangayClearanceDoc: _barangayClearanceDoc,
    taxIncentivesDoc: _taxIncentivesDoc, swornStatementDoc: _swornStatementDoc,
    ...snapshotFields
  } = values;
  const formSnapshot = { source: "online" as const, fields: snapshotFields };

  const { data: application, error: appError } = await supabase
    .from("applications")
    .insert({
      lgu_id: lguId,
      business_id: businessId,
      application_type: body.applicationType,
      application_year: year,
      status: "pending_bplo_initial",
      form_inputs: formInputs,
      form_snapshot: formSnapshot,
      reference_number: referenceNumber,
      declaration_accepted_at: new Date().toISOString(),
    })
    .select("id, reference_number")
    .single();
  if (appError || !application) {
    return NextResponse.json({ error: "application_create_failed" }, { status: 500 });
  }

  const documentIds = Object.values(body.documents ?? {}).filter((id): id is string => Boolean(id));
  if (documentIds.length > 0) {
    await supabase
      .from("documents")
      .update({ application_id: application.id })
      .in("id", documentIds)
      .is("application_id", null)
      .like("file_url", `${ownerId}/%`);
  }

  const applicantName = [body.firstName, body.lastName].filter(Boolean).join(" ") || "Applicant";
  await logAuditEvent(supabase, {
    lguId,
    applicationId: application.id,
    actorRole: null,
    actorLabel: `${applicantName} (Applicant)`,
    action: "application_submitted",
    summary: `${body.applicationType === "renewal" ? "Renewal" : "New"} application submitted -- ${body.businessName} (${application.reference_number})`,
    details: { applicationType: body.applicationType, businessName: body.businessName },
  });

  // CLAUDE.md 7w -- BPLO previously had no signal a new application
  // landed in their queue except checking their own dashboard cold.
  await notifyStaffByRole(
    lguId,
    "bplo",
    application.id,
    `New application: ${application.reference_number}`,
    `<p>New ${body.applicationType} application -- <strong>${body.businessName}</strong> (Owner: ${applicantName}). Needs initial review.</p><p>Application: ${application.reference_number}</p>`,
    `New application ${application.reference_number} (${body.businessName}) needs initial review.`
  );

  return NextResponse.json({ referenceNumber: application.reference_number });
}

function isBlank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function yesNoToBoolean(value: string | undefined): boolean | null {
  if (value === "Yes") return true;
  if (value === "No") return false;
  return null;
}
