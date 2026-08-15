"use server";

import { getCurrentStaff } from "@/lib/staff";
import { notifyApplicantSms, notifyStaffByRole } from "@/lib/notifications";
import { actorLabelFor, logAuditEvent } from "@/lib/audit-log";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

/**
 * Treasury confirms payment (pending_payment -> pending_printing, not
 * straight to pending_mayor -- the permit still needs to be printed
 * before it's ready for the Mayor's signature, see CLAUDE.md 7i). Rule
 * #7: Treasury is a read-only checkpoint on the FEE AMOUNT -- they
 * record that payment was received and an OR number, never adjust
 * what's owed. The payments INSERT uses the caller's own RLS-scoped
 * session (migration 0002's "only treasury can record payments" policy
 * enforces the role check for real); advancing applications.status uses
 * the service role afterward since neither role has direct UPDATE rights
 * on applications, same cross-cutting-advancement pattern as the
 * department/BPLO actions.
 *
 * BPLO can also call this (migration 0030, CLAUDE.md 7v) -- a real,
 * live-tested gap: a walk-in applicant who pays at the Treasury counter
 * and brings the OR receipt straight to BPLO had no path forward before
 * this, since only Treasury could record it. BPLO gains exactly what
 * Treasury already had here (confirm payment, record an OR number) --
 * rule #7's actual restriction, never adjusting what's owed, is
 * unaffected; this function still never touches application_fee_lines.
 * The audit log tags a BPLO-recorded payment distinctly ("on behalf of
 * Treasury") so the trail shows who actually typed it in, same reasoning
 * as department_reviews.acted_on_behalf for a BPLO proxy decision --
 * payments has no equivalent column, so this is captured in
 * audit_log's free-text summary instead (received_by already points at
 * the real actor's own staff_users row either way).
 */
export async function recordPayment(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || (staff.role !== "treasury" && staff.role !== "bplo")) throw new Error("Not authorized");
  const actedOnBehalf = staff.role === "bplo";

  const applicationId = String(formData.get("applicationId"));
  const amount = Number(formData.get("amount"));
  const method = String(formData.get("method") ?? "").trim() || null;
  const orNumber = String(formData.get("orNumber") ?? "").trim() || null;

  if (!amount || amount <= 0) throw new Error("Invalid amount");

  const supabase = await createClient();
  const { error: paymentError } = await supabase.from("payments").insert({
    application_id: applicationId,
    amount,
    method,
    or_number: orNumber,
    received_by: staff.id,
  });
  if (paymentError) throw paymentError;

  const service = createServiceClient();
  const { data: updated, error: statusError } = await service
    .from("applications")
    .update({ status: "pending_printing" })
    .eq("id", applicationId)
    .eq("status", "pending_payment")
    .select("reference_number, business:businesses(owner:owners(phone))")
    .single();
  if (statusError || !updated) throw statusError ?? new Error("Update failed");

  const business = updated.business as unknown as { owner: { phone: string | null } | null } | null;
  if (business?.owner?.phone) {
    await notifyApplicantSms(
      applicationId,
      business.owner.phone,
      `MuniServe: we received your payment for application ${updated.reference_number}. Your permit is now being printed.`
    );
  }

  // CLAUDE.md 7w -- BPLO previously had no signal an application was
  // ready to print except checking their own dashboard cold.
  await notifyStaffByRole(
    staff.lgu_id,
    "bplo",
    applicationId,
    `Ready to print: ${updated.reference_number}`,
    `<p><strong>${updated.reference_number}</strong> -- payment received, ready to print.</p>`,
    `MuniServe: ${updated.reference_number} payment received -- ready to print.`
  );

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    applicationId,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "payment_recorded",
    summary: `Payment of ₱${amount.toLocaleString()} recorded for ${updated.reference_number}${actedOnBehalf ? " (BPLO, on behalf of Treasury)" : ""}`,
    details: { amount, method, orNumber },
  });

  revalidatePath("/dashboard/treasury");
  revalidatePath("/dashboard/bplo");
}
