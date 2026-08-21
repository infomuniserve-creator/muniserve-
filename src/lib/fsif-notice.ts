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
      `Your application ${ref} needs one more payment: the Fire Safety Inspection Fee (FSIF), paid directly to the Bureau of Fire Protection (BFP), separate from MuniServe. Check your email or status page to pay and upload your proof.`
    );
  }

  if (owner?.email) {
    const lgu = await getLguDisplay(supabase, params.lguId);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const statusUrl = `${appUrl}/status/${ref}`;

    // The real, functional path in MuniServe: an upload here is what BFP's
    // own department review queue actually reads from (getApplicationDocuments,
    // the same mechanism CLAUDE.md 7c/7ll's info-request uploads already
    // use) -- so this is the CTA, not a plain link to the payment portal
    // itself. Direct email/SMS to BFP is offered only as a supplementary
    // option, and only when a real BFP staff account with contact info
    // actually exists (2026-08-21 follow-up -- a separate manually-typed
    // Settings field would just duplicate what BPLO already enters when
    // adding a BFP staff member, staff_users.email/phone, CLAUDE.md 7m/7w;
    // this looks it up live instead). Excludes an admin-proxy row, same
    // exclusion notifyStaffByRole already applies -- its email is a
    // synthetic, unreachable placeholder.
    const { data: bfpStaff } = await supabase
      .from("staff_users")
      .select("email, phone")
      .eq("lgu_id", params.lguId)
      .eq("role", "department")
      .eq("department", bfpDept.name)
      .eq("is_active", true)
      .eq("is_admin_proxy", false);
    const bfpEmails = [...new Set((bfpStaff ?? []).map((s) => s.email).filter((e): e is string => Boolean(e)))];
    const bfpPhones = [...new Set((bfpStaff ?? []).map((s) => s.phone).filter((p): p is string => Boolean(p)))];

    const directContactLine =
      bfpEmails.length > 0 || bfpPhones.length > 0
        ? `<p style="margin:16px 0 0;">You can also send a copy directly to BFP — include your Permit ID (<strong>${ref}</strong>) so they can match it:<br />${[
            bfpEmails.length > 0 ? `Email: ${bfpEmails.join(", ")}` : null,
            bfpPhones.length > 0 ? `Phone/SMS: ${bfpPhones.join(", ")}` : null,
          ]
            .filter(Boolean)
            .join("<br />")}</p>`
        : "";

    const bodyHtml = `<p style="margin:0 0 14px;">Your application (<strong>${ref}</strong>) is now being reviewed by every department at once, including the <strong>Bureau of Fire Protection (BFP)</strong>.</p><p style="margin:0 0 14px;"><strong>BFP works independently from the local government</strong> — so the Fire Safety Inspection Fee (FSIF), required by law (RA 9514, the Fire Code of the Philippines), must be paid directly to BFP. This is separate from anything else on your application.</p><p style="margin:0 0 6px;"><strong>How to pay the FSIF:</strong></p><p style="margin:0 0 4px;">1. Pay online at ${FSIF_PORTAL_URL}, or in person at the BFP office.</p><p style="margin:0 0 14px;">2. Save your official receipt, transaction reference number, or a screenshot if you paid online.</p><p style="margin:0;">3. Upload it using the button below — BFP will see it automatically and can continue reviewing your application.</p>${directContactLine}`;

    const html = renderApplicantEmailHtml({
      lgu,
      officeLabel: lgu.bploOfficeName,
      greetingName: firstNameOf(owner.full_name),
      bodyHtml,
      cta: { label: "Upload your payment proof", href: statusUrl },
    });
    await notifyApplicantEmail(params.applicationId, owner.email, `Action needed: pay the Fire Safety Inspection Fee — ${ref}`, html);
  }
}
