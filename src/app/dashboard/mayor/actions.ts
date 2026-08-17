"use server";

import { getCurrentStaff } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { generatePermitAssets } from "@/lib/permit-pdf";
import { notifyApplicantSms, notifyStaffByRole } from "@/lib/notifications";
import { actorLabelFor, logAuditEvent } from "@/lib/audit-log";
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
 * Signs the permit (pending_mayor -> pending_release, not straight to
 * released -- the signed permit still has to be physically handed to
 * the applicant, a separate BPLO checkpoint, see bplo/actions.ts's
 * markReleased and CLAUDE.md 7i). Creates the permits row via the
 * caller's own RLS-scoped session (migration 0002's "only mayor can
 * issue permits" policy, widened by migration 0032 to also cover BPLO --
 * see below); advancing applications.status uses the service role
 * afterward, same pattern as the other role-gated actions.
 *
 * BPLO can call this on the Mayor's behalf (migration 0032, CLAUDE.md 7w
 * follow-up) -- the real physical process at this pilot LGU: BPLO prints
 * the permit and carries it to the Mayor's office themselves (no
 * dashboard notification needed there, see markPrinted), the Mayor signs
 * it on paper, and BPLO carries the signed copy back and marks it here.
 * The Mayor's own dashboard path still works unchanged for any LGU where
 * the Mayor genuinely does this themselves -- same "widen, don't
 * replace" shape as rule #9's department-decision-on-behalf and payments
 * (migration 0030). The audit log tags a BPLO-recorded signature
 * distinctly, same reasoning as recordPayment's "(on behalf of
 * Treasury)" tag -- permits has no acted_on_behalf column the way
 * department_reviews does.
 *
 * permit_number reuses the application's own reference_number (e.g.
 * MS-2026-00001) rather than a separate counter -- one human-readable
 * identifier per application is simpler and just as traceable as minting
 * a second one. valid_until is December 31 of the application year per
 * CLAUDE.md section 6's cited Section 4.04 (permits expire end of
 * calendar year).
 *
 * PDF + QR code (CLAUDE.md 7k) are generated right after the permits row
 * exists, uploaded to the public permit-pdfs bucket (migration 0014),
 * then the same row is updated with both URLs. A generation/upload
 * failure here is swallowed, not thrown -- the permit is already legally
 * issued at this point (the insert above succeeded), so a PDF renderer
 * bug must never block the actual signature from recording. pdf_url/
 * qr_code_url just stay null until it's retried or fixed.
 *
 * Also appends a permit_history row (migration 0012) -- CLAUDE.md
 * section 7f's "option 2": Permit History stays a living log instead of
 * freezing at the 2020-2026 import the day MuniServe went live. `category`
 * stays null for these rows -- the historical source's 4-bucket
 * classification (Manufacturing/Real Estate/Retail-Trade/Services) has no
 * real equivalent captured anywhere on a MuniServe application, and
 * guessing one from nature_of_business isn't something to do without
 * confirming the mapping against the real ordinance first (same standing
 * rule as CLAUDE.md 7b/7d for fee rates and form fields). Recorded here,
 * at signing, rather than at the later release step -- the permit is
 * legally issued the moment the Mayor signs it; release is just the
 * physical hand-off.
 */
export async function signPermit(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || (staff.role !== "mayor" && staff.role !== "bplo")) throw new Error("Not authorized");
  const actedOnBehalf = staff.role === "bplo";

  const applicationId = String(formData.get("applicationId"));

  const supabase = await createClient();
  // Guard checked first, before any of this function's real side effects
  // (permit issuance, the public PDF, the "ready for pickup" SMS) --
  // audit finding (2026-08-17): this used to only get checked at the very
  // end, via the applications status UPDATE, by which point everything
  // above it had already happened unconditionally. It was only ever saved
  // by permits.permit_number's own unique constraint colliding on a
  // re-sign -- an application that was never at pending_mayor at all
  // (still mid-department-review, say) had nothing stopping it from
  // sailing straight through and getting a real, publicly-verifiable
  // permit issued. Matches the same guarded-fetch pattern markPrinted/
  // markReleased (bplo/actions.ts) already use correctly.
  const { data: application, error: fetchError } = await supabase
    .from("applications")
    .select(
      `reference_number, application_year, application_type, form_inputs, business_id,
       business:businesses(business_name, unit_street, city_town, barangay, province, zip_code, address, nature_of_business, organization_type, business_tax_payment, legacy_license_no, legacy_owner_name, owner:owners(full_name, gender, phone))`
    )
    .eq("id", applicationId)
    .eq("status", "pending_mayor")
    .single();
  if (fetchError || !application) throw fetchError ?? new Error("Application not found or not ready to sign");

  const issuedAt = new Date();
  const validUntil = `${application.application_year}-12-31`;

  const { data: permit, error: permitError } = await supabase
    .from("permits")
    .insert({
      application_id: applicationId,
      permit_number: application.reference_number,
      issued_at: issuedAt.toISOString(),
      valid_until: validUntil,
    })
    .select("id")
    .single();
  if (permitError || !permit) throw permitError ?? new Error("Permit insert failed");

  const service = createServiceClient();
  const { data: payments } = await service.from("payments").select("amount").eq("application_id", applicationId);
  const amountPaid = (payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);

  const business = application.business as unknown as {
    business_name: string;
    unit_street: string | null;
    city_town: string | null;
    barangay: string | null;
    province: string | null;
    zip_code: string | null;
    address: string | null; // legacy free-text fallback, pre-structured-address businesses
    nature_of_business: string | null;
    organization_type: string | null;
    business_tax_payment: string | null;
    legacy_license_no: string | null;
    legacy_owner_name: string | null;
    owner: { full_name: string; gender: string | null; phone: string | null } | null;
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

  const structuredAddress = [business?.unit_street, business?.city_town, business?.barangay, business?.province, business?.zip_code]
    .filter(Boolean)
    .join(", ");
  const address = structuredAddress || business?.address || "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const verifyUrl = `${appUrl}/verify/${application.reference_number}`;

  try {
    const lgu = await getLguDisplay(supabase, staff.lgu_id);
    const { pdf, qrPng } = await generatePermitAssets({
      referenceNumber: application.reference_number,
      businessName: business?.business_name ?? "(business record missing)",
      ownerName: business?.owner?.full_name ?? business?.legacy_owner_name ?? "—",
      applicationType: application.application_type as "new" | "renewal",
      natureOfBusiness: business?.nature_of_business ?? null,
      address,
      issuedAt,
      validUntil,
      verifyUrl,
      lgu,
    });

    const pdfPath = `${applicationId}/permit.pdf`;
    const qrPath = `${applicationId}/qr.png`;
    const [pdfUpload, qrUpload] = await Promise.all([
      service.storage.from("permit-pdfs").upload(pdfPath, pdf, { contentType: "application/pdf", upsert: true }),
      service.storage.from("permit-pdfs").upload(qrPath, qrPng, { contentType: "image/png", upsert: true }),
    ]);
    if (pdfUpload.error) throw pdfUpload.error;
    if (qrUpload.error) throw qrUpload.error;

    const pdfUrl = service.storage.from("permit-pdfs").getPublicUrl(pdfPath).data.publicUrl;
    const qrCodeUrl = service.storage.from("permit-pdfs").getPublicUrl(qrPath).data.publicUrl;

    await service.from("permits").update({ pdf_url: pdfUrl, qr_code_url: qrCodeUrl }).eq("id", permit.id);
  } catch (pdfGenError) {
    // Best-effort, same reasoning as src/lib/notifications.ts -- the
    // permit is already legally issued (the insert above succeeded), a
    // PDF renderer/upload failure must never undo or block that.
    console.error("Permit PDF/QR generation failed", pdfGenError);
  }

  const { error: statusError } = await service
    .from("applications")
    .update({ status: "pending_release" })
    .eq("id", applicationId)
    .eq("status", "pending_mayor");
  if (statusError) throw statusError;

  // CLAUDE.md 7w -- only notify BPLO when the Mayor genuinely signed it
  // themselves; when BPLO is the one calling this on the Mayor's behalf
  // (the real process at this pilot LGU), they already know it's done --
  // notifying them of their own action is just noise.
  if (!actedOnBehalf) {
    await notifyStaffByRole(
      staff.lgu_id,
      "bplo",
      applicationId,
      `Ready for release: ${application.reference_number}`,
      `<p><strong>${application.reference_number}</strong> has been signed -- ready for release to the applicant.</p>`,
      `${application.reference_number} signed -- ready for release.`
    );
  }

  // The applicant hears about this the moment it's signed, not only once
  // it's physically handed over (markReleased's own SMS) -- "ready for
  // pickup" is real, actionable information the moment it's true.
  if (business?.owner?.phone) {
    await notifyApplicantSms(
      applicationId,
      staff.lgu_id,
      business.owner.phone,
      `your business permit (${application.reference_number}) has been signed and is ready for pickup at the BPLO office.`
    );
  }

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    applicationId,
    actorRole: staff.role,
    actorLabel: actedOnBehalf ? `${actorLabelFor(staff)} on behalf of Mayor's Office` : actorLabelFor(staff),
    action: "permit_signed",
    summary: `Permit signed for ${application.reference_number} -- valid until ${validUntil}${actedOnBehalf ? " (BPLO, on behalf of Mayor's Office)" : ""}`,
    details: { permitNumber: application.reference_number, validUntil, amountPaid, actedOnBehalf },
  });

  revalidatePath("/dashboard/mayor");
  revalidatePath("/dashboard/bplo");
  revalidatePath("/dashboard/businesses");
  revalidatePath("/dashboard/businesses/history");
}
