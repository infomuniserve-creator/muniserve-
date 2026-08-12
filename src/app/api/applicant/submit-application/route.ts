import { getApplicantOwnerId } from "@/lib/applicant-session";
import { getPilotLguId } from "@/lib/lgu";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

type SubmitBody = {
  applicationType: "new" | "renewal";
  businessId?: string;
  businessName: string;
  barangay?: string;
  address?: string;
  natureOfBusiness: string;
  lbtCategory: string;
  basisAmount: number;
  billiardTableCount?: number;
  lodgerCount?: number;
  floorAreaSqm?: number;
  documentIds: string[];
};

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
 */
export async function POST(request: Request) {
  const ownerId = await getApplicantOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as SubmitBody | null;
  if (!body || !body.applicationType || !body.businessName || !body.natureOfBusiness) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const lguId = await getPilotLguId();
  const year = new Date().getFullYear();

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
    history[String(year)] = body.basisAmount;

    const { error: updateError } = await supabase
      .from("businesses")
      .update({
        business_name: body.businessName,
        barangay: body.barangay ?? null,
        address: body.address ?? null,
        nature_of_business: body.natureOfBusiness,
        lbt_category: body.lbtCategory,
        gross_sales_history: history,
      })
      .eq("id", body.businessId);
    if (updateError) {
      return NextResponse.json({ error: "business_update_failed" }, { status: 500 });
    }
    businessId = body.businessId;
  } else {
    const { data: newBusiness, error: createError } = await supabase
      .from("businesses")
      .insert({
        lgu_id: lguId,
        owner_id: ownerId,
        business_name: body.businessName,
        barangay: body.barangay ?? null,
        address: body.address ?? null,
        nature_of_business: body.natureOfBusiness,
        lbt_category: body.lbtCategory,
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

  const formInputs = {
    nature_of_business: body.natureOfBusiness,
    lbt_category: body.lbtCategory,
    basis_amount: body.basisAmount,
    billiard_table_count: body.billiardTableCount ?? null,
    lodger_count: body.lodgerCount ?? null,
    floor_area_sqm: body.floorAreaSqm ?? null,
  };

  const { data: application, error: appError } = await supabase
    .from("applications")
    .insert({
      lgu_id: lguId,
      business_id: businessId,
      application_type: body.applicationType,
      application_year: year,
      status: "pending_bplo_initial",
      form_inputs: formInputs,
      reference_number: referenceNumber,
    })
    .select("id, reference_number")
    .single();
  if (appError || !application) {
    return NextResponse.json({ error: "application_create_failed" }, { status: 500 });
  }

  if (body.documentIds?.length) {
    await supabase
      .from("documents")
      .update({ application_id: application.id })
      .in("id", body.documentIds)
      .is("application_id", null)
      .like("file_url", `${ownerId}/%`);
  }

  return NextResponse.json({ referenceNumber: application.reference_number });
}
