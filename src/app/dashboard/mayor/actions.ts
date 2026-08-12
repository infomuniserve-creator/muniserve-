"use server";

import { getCurrentStaff } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

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
 */
export async function signAndRelease(formData: FormData) {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "mayor") throw new Error("Not authorized");

  const applicationId = String(formData.get("applicationId"));

  const supabase = await createClient();
  const { data: application, error: fetchError } = await supabase
    .from("applications")
    .select("reference_number, application_year")
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
  const { error: statusError } = await service
    .from("applications")
    .update({ status: "released" })
    .eq("id", applicationId)
    .eq("status", "pending_mayor");
  if (statusError) throw statusError;

  revalidatePath("/dashboard/mayor");
}
