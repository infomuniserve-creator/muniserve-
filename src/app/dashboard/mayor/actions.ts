"use server";

import { getCurrentStaff } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

/**
 * The historical import's "Pay Frequency" vocabulary (Yearly/Quarterly/
 * Bi-Annually, from permit_history_san_miguel.json) differs slightly from
 * the applicant form's own (Annual/Bi-Annually/Quarterly,
 * san-miguel-form-options.ts's BUSINESS_TAX_PAYMENT_OPTIONS) even though
 * they mean the same thing. Normalized here, at the one place a
 * MuniServe-originated row joins the historical log, so permit_history's
 * own Pay Frequency filter doesn't end up with two spellings of "yearly."
 * businesses.business_tax_payment itself is left alone -- this mapping
 * only affects what gets written into permit_history.
 */
const PAY_FREQUENCY_TO_HISTORY: Record<string, string> = {
  Annual: "Yearly",
};

/**
 * Mayor signs and releases (pending_mayor -> released). Creates the
 * permits row via the Mayor's own RLS-scoped session (migration 0002's
 * "only mayor can issue permits" policy enforces the role check for
 * real); advancing applications.status uses the service role afterward,
 * same pattern as the other role-gated actions.
 *
 * permit_number reuses the application's own reference_number (e.g.
 * MS-2026-00001) rather than a separate counter -- one human-readable
 * identifier per application is simpler and just as traceable as minting
 * a second one. valid_until is December 31 of the application year per
 * CLAUDE.md section 6's cited Section 4.04 (permits expire end of
 * calendar year). Permit PDF/QR generation is build order step 8, not
 * built yet -- pdf_url and qr_code_url stay null here.
 *
 * Also appends a permit_history row (migration 0012) -- CLAUDE.md
 * section 7f's "option 2": Permit History stays a living log instead of
 * freezing at the 2020-2026 import the day MuniServe went live. `category`
 * stays null for these rows -- the historical source's 4-bucket
 * classification (Manufacturing/Real Estate/Retail-Trade/Services) has no
 * real equivalent captured anywhere on a MuniServe application, and
 * guessing one from nature_of_business isn't something to do without
 * confirming the mapping against the real ordinance first (same standing
 * rule as CLAUDE.md 7b/7d for fee rates and form fields).
 */
export async function signAndRelease(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "mayor") throw new Error("Not authorized");

  const applicationId = String(formData.get("applicationId"));

  const supabase = await createClient();
  const { data: application, error: fetchError } = await supabase
    .from("applications")
    .select(
      `reference_number, application_year, application_type, form_inputs, business_id,
       business:businesses(business_name, barangay, nature_of_business, organization_type, business_tax_payment, legacy_license_no, legacy_owner_name, owner:owners(full_name, gender))`
    )
    .eq("id", applicationId)
    .single();
  if (fetchError || !application) throw fetchError ?? new Error("Application not found");

  const { error: permitError } = await supabase.from("permits").insert({
    application_id: applicationId,
    permit_number: application.reference_number,
    issued_at: new Date().toISOString(),
    valid_until: `${application.application_year}-12-31`,
  });
  if (permitError) throw permitError;

  const service = createServiceClient();
  const { data: payments } = await service.from("payments").select("amount").eq("application_id", applicationId);
  const amountPaid = (payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);

  const business = application.business as unknown as {
    business_name: string;
    barangay: string | null;
    nature_of_business: string | null;
    organization_type: string | null;
    business_tax_payment: string | null;
    legacy_license_no: string | null;
    legacy_owner_name: string | null;
    owner: { full_name: string; gender: string | null } | null;
  } | null;
  const formInputs = application.form_inputs as { capital_investment?: number | null; gross_sales?: number | null } | null;

  const { error: historyError } = await supabase.from("permit_history").insert({
    lgu_id: staff.lgu_id,
    business_id: application.business_id,
    year: application.application_year,
    permit_no: application.reference_number,
    business_name: business?.business_name ?? "(business record missing)",
    owner_name: business?.owner?.full_name ?? business?.legacy_owner_name ?? null,
    barangay: business?.barangay ?? null,
    application_type: application.application_type,
    category: null,
    description: business?.nature_of_business ?? null,
    owner_type: business?.organization_type ?? null,
    gender: business?.owner?.gender ?? null,
    amount_paid: amountPaid || null,
    capital: formInputs?.capital_investment ?? null,
    gross_sales: formInputs?.gross_sales ?? null,
    pay_frequency: business?.business_tax_payment ? PAY_FREQUENCY_TO_HISTORY[business.business_tax_payment] ?? business.business_tax_payment : null,
    legacy_license_no: business?.legacy_license_no ?? null,
  });
  if (historyError) throw historyError;

  const { error: statusError } = await service
    .from("applications")
    .update({ status: "released" })
    .eq("id", applicationId)
    .eq("status", "pending_mayor");
  if (statusError) throw statusError;

  revalidatePath("/dashboard/mayor");
  revalidatePath("/dashboard/businesses");
  revalidatePath("/dashboard/businesses/history");
}
