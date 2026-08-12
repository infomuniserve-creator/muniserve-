"use server";

import { getCurrentStaff } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

/**
 * Treasury confirms payment (pending_payment -> pending_mayor). Rule #7:
 * Treasury is a read-only checkpoint on the FEE AMOUNT -- they record
 * that payment was received and an OR number, never adjust what's owed.
 * The payments INSERT uses Treasury's own RLS-scoped session (migration
 * 0002's "only treasury can record payments" policy enforces the role
 * check for real); advancing applications.status uses the service role
 * afterward since Treasury has no direct UPDATE rights on applications,
 * same cross-cutting-advancement pattern as the department/BPLO actions.
 */
export async function recordPayment(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "treasury") throw new Error("Not authorized");

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
  const { error: statusError } = await service
    .from("applications")
    .update({ status: "pending_mayor" })
    .eq("id", applicationId)
    .eq("status", "pending_payment");
  if (statusError) throw statusError;

  revalidatePath("/dashboard/treasury");
}
