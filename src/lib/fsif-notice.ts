import type { SupabaseClient } from "@supabase/supabase-js";
import { getLguDisplay } from "@/lib/lgu";
import { notifyApplicantEmail, notifyApplicantSms } from "@/lib/notifications";
import { firstNameOf, renderApplicantEmailHtml } from "@/lib/applicant-email-template";

/**
 * Fire Safety Inspection Fee (FSIF) notice (2026-08-21) -- BFP (Bureau of
 * Fire Protection) is one of San Miguel's real reviewing departments
 * (CLAUDE.md 7c), but it works independently from the LGU: the FSIF, a
 * real national fee mandated by RA 9514 (the Fire Code of the
 * Philippines), is paid directly to BFP through their own national e-BFP
 * portal, never through MuniServe -- the project owner's own prior
 * (pre-MuniServe) system sent an automated email explaining exactly this
 * the moment an application entered department review. This module is
 * that same notice, rebuilt on the new applicant-email-template shell.
 *
 * The e-BFP portal URL is a fixed national government system, not a
 * per-LGU setting -- every municipality's applicants pay FSIF at the same
 * address, so this is hardcoded (a confirmed real-world fact the project
 * owner supplied directly, not a guess this project's standing rule
 * against inventing real-world specifics would otherwise warn against).
 */
const FSIF_PORTAL_URL = "https://fsis.e-bfp.com/register";

/** Case-insensitive on purpose -- `lgu_departments.name` is free text an LGU set at onboarding (CLAUDE.md 7o/7yy), and "BFP" is the exact string San Miguel's own real row uses. */
const BFP_DEPARTMENT_NAME = "BFP";

/**
 * Called once, right after BPLO's own initial-review approval (bplo/
 * actions.ts's submitInitialReview) -- deliberately not from the walk-in
 * path or a resubmission reopening BFP's round, so this can never
 * double-send. A no-op for any LGU with no active department literally
 * named "BFP" -- most future LGUs onboarded won't have this fee at all,
 * and there's nothing to tell an applicant about a fee that doesn't apply
 * to them.
 */
export async function notifyApplicantOfFsifIfDue(supabase: SupabaseClient, params: { applicationId: string; lguId: string }): Promise<void> {
  const { data: bfpDept } = await supabase
    .from("lgu_departments")
    .select("name")
    .eq("lgu_id", params.lguId)
    .eq("is_active", true)
    .ilike("name", BFP_DEPARTMENT_NAME)
    .maybeSingle();
  if (!bfpDept) return;

  const { data: application } = await supabase
    .from("applications")
    .select("reference_number, business:businesses(owner:owners(phone, email, full_name))")
    .eq("id", params.applicationId)
    .single();
  if (!application) return;
  const owner = (application.business as unknown as { owner: { phone: string | null; email: string | null; full_name: string | null } | null } | null)?.owner;
  const ref = application.reference_number;

  if (owner?.phone) {
    await notifyApplicantSms(
      params.applicationId,
      params.lguId,
      owner.phone,
      `Your application ${ref} needs one more payment: the Fire Safety Inspection Fee (FSIF), paid directly to the Bureau of Fire Protection (BFP), separate from MuniServe. Check your email or status page for how to pay.`
    );
  }

  if (owner?.email) {
    const lgu = await getLguDisplay(supabase, params.lguId);

    const sendProofStep =
      lgu.bfpContactEmail || lgu.bfpContactPhone
        ? `<p style="margin:0 0 4px;">3. Send your proof of payment to BFP:</p><p style="margin:0 0 14px;padding-left:14px;">${[
            lgu.bfpContactEmail ? `Email: ${lgu.bfpContactEmail}` : null,
            lgu.bfpContactPhone ? `Phone/SMS: ${lgu.bfpContactPhone}` : null,
          ]
            .filter(Boolean)
            .join("<br />")}</p>`
        : `<p style="margin:0 0 14px;">3. Bring your proof of payment to the BFP office.</p>`;

    const bodyHtml = `<p style="margin:0 0 14px;">Your application (<strong>${ref}</strong>) is now being reviewed by every department at once, including the <strong>Bureau of Fire Protection (BFP)</strong>.</p><p style="margin:0 0 14px;"><strong>BFP works independently from the local government</strong> — so the Fire Safety Inspection Fee (FSIF), required by law (RA 9514, the Fire Code of the Philippines), must be paid directly to BFP. This is separate from anything else on your application.</p><p style="margin:0 0 6px;"><strong>How to pay the FSIF:</strong></p><p style="margin:0 0 4px;">1. Pay online at ${FSIF_PORTAL_URL}, or in person at the BFP office.</p><p style="margin:0 0 14px;">2. Save your official receipt, transaction reference number, or a screenshot if you paid online.</p>${sendProofStep}<p style="margin:0;">4. Include your Permit ID (<strong>${ref}</strong>) so BFP can match your payment to your application.</p>`;

    const html = renderApplicantEmailHtml({
      lgu,
      officeLabel: lgu.bploOfficeName,
      greetingName: firstNameOf(owner.full_name),
      bodyHtml,
      cta: { label: "Pay the Fire Safety Inspection Fee", href: FSIF_PORTAL_URL },
    });
    await notifyApplicantEmail(params.applicationId, owner.email, `Action needed: pay the Fire Safety Inspection Fee — ${ref}`, html);
  }
}
