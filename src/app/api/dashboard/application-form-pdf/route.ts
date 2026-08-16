import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { BUSINESS_PROFILE_COLUMNS, mapBusinessProfile } from "@/lib/business-profile";
import { generateApplicationFormPdf, type ApplicationFormSnapshot } from "@/lib/application-form-pdf";
import type { FieldKey } from "@/lib/application-form-logic";
import { createClient } from "@/lib/supabase/server";

/**
 * Serves the downloadable "submitted application form" PDF (CLAUDE.md
 * follow-up after 7bb) -- a staff-only, non-editable record of exactly
 * what was filed for one application. Any staff role at the application's
 * own LGU can download it (read-only, same audience as the Business
 * Registry's own read-for-all-roles access), not just BPLO.
 *
 * Prefers `applications.form_snapshot` (migration 0036) when present.
 * Older applications (filed before that column existed) have none --
 * falls back to reconstructing from the business's CURRENT profile plus
 * this application's own form_inputs, and generateApplicationFormPdf()
 * renders a visible disclaimer in that case rather than presenting
 * possibly-since-changed data as if it were the original submission.
 */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const applicationId = request.nextUrl.searchParams.get("applicationId");
  if (!applicationId) {
    return NextResponse.json({ error: "applicationId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: application, error } = await supabase
    .from("applications")
    .select(
      `reference_number, application_type, application_year, submitted_at, declaration_accepted_at, form_snapshot, form_inputs, lgu_id,
       business:businesses(${BUSINESS_PROFILE_COLUMNS}, owner:owners(full_name, phone))`
    )
    .eq("id", applicationId)
    .eq("lgu_id", staff.lgu_id)
    .single();
  if (error || !application) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  const business = application.business as unknown as
    | (Record<string, unknown> & { id: string; business_name: string; owner: { full_name: string; phone: string | null } | null })
    | null;

  const { data: docs } = await supabase
    .from("documents")
    .select("document_type, uploaded_at")
    .eq("application_id", applicationId)
    .order("uploaded_at", { ascending: true });

  let snapshot: ApplicationFormSnapshot;
  if (application.form_snapshot) {
    snapshot = application.form_snapshot as ApplicationFormSnapshot;
  } else {
    const formInputs = application.form_inputs as { capital_investment?: number | null; gross_sales?: number | null } | null;
    let profileFields: Partial<Record<FieldKey, unknown>> = {};
    if (business) {
      const { id: _id, lbtCategory: _lbtCategory, ...rest } = mapBusinessProfile(business);
      profileFields = rest as Partial<Record<FieldKey, unknown>>;
    }
    snapshot = {
      source: "reconstructed",
      fields: {
        ...profileFields,
        // Prefer this specific application's own figure when the row has
        // one in the current shape; fall back to the business's current
        // derived value (already in profileFields) rather than dropping
        // the amount entirely -- caught via a real pre-migration
        // application whose form_inputs predates capital_investment/
        // gross_sales (an older `basis_amount`-shaped row), which would
        // otherwise have silently omitted a real, known gross sales figure.
        capitalInvestment: formInputs?.capital_investment ?? profileFields.capitalInvestment,
        grossSales: formInputs?.gross_sales ?? profileFields.grossSales,
      },
    };
  }

  const lgu = await getLguDisplay(supabase, application.lgu_id);

  const pdf = await generateApplicationFormPdf({
    referenceNumber: application.reference_number,
    applicationType: application.application_type as "new" | "renewal",
    applicationYear: application.application_year,
    submittedAt: new Date(application.submitted_at),
    businessName: business?.business_name ?? "(business record missing)",
    ownerName: business?.owner?.full_name ?? "—",
    ownerPhone: business?.owner?.phone ?? null,
    snapshot,
    documents: (docs ?? []).map((d) => ({ documentType: d.document_type, uploadedAt: d.uploaded_at })),
    declarationAcceptedAt: application.declaration_accepted_at,
    lgu,
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${application.reference_number}-submitted-form.pdf"`,
    },
  });
}
