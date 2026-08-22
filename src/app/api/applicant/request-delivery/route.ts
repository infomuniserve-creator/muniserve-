import { getApplicantOwnerId } from "@/lib/applicant-session";
import { getLguDisplay } from "@/lib/lgu";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyCourierSms } from "@/lib/notifications";
import { logAuditEvent } from "@/lib/audit-log";
import { NextResponse } from "next/server";

/**
 * Delivery Service (2026-08-22, project owner's own idea, discussed and
 * confirmed on the status page specifically): the one-time "please
 * deliver this instead" action for an applicant whose permit has reached
 * pending_release. Requires the LGU to have Delivery Service turned on
 * (settings/actions.ts's updateDeliveryService) -- otherwise there's no
 * courier contact to notify at all.
 *
 * Same ownership check as upload-additional-document/route.ts: the
 * application must belong to the caller's own owner_id, verified via the
 * business -> owner chain, not just the applicant_session cookie's
 * presence.
 */
export async function POST(request: Request) {
  const ownerId = await getApplicantOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const applicationId = String(body?.applicationId ?? "");
  if (!applicationId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: application, error: fetchError } = await supabase
    .from("applications")
    .select(
      `id, lgu_id, status, reference_number, delivery_requested_at,
       business:businesses(business_name, owner_id, unit_street, barangay, city_town, province, zip_code, owner:owners(full_name, phone))`
    )
    .eq("id", applicationId)
    .maybeSingle();

  const business = application?.business as unknown as {
    business_name: string;
    owner_id: string | null;
    unit_street: string | null;
    barangay: string | null;
    city_town: string | null;
    province: string | null;
    zip_code: string | null;
    owner: { full_name: string | null; phone: string | null } | null;
  } | null;

  if (fetchError || !application || business?.owner_id !== ownerId) {
    return NextResponse.json({ error: "not_found_or_not_yours" }, { status: 403 });
  }
  if (application.status !== "pending_release") {
    return NextResponse.json({ error: "not_ready_for_release" }, { status: 400 });
  }
  if (application.delivery_requested_at) {
    return NextResponse.json({ ok: true, alreadyRequested: true });
  }

  const lgu = await getLguDisplay(supabase, application.lgu_id);
  if (!lgu.deliveryServiceEnabled || !lgu.courierPhone) {
    return NextResponse.json({ error: "delivery_not_available" }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from("applications")
    .update({ delivery_requested_at: new Date().toISOString() })
    .eq("id", applicationId)
    .is("delivery_requested_at", null);
  if (updateError) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  const address = [business?.unit_street, business?.barangay, business?.city_town, business?.province, business?.zip_code].filter(Boolean).join(", ");
  await notifyCourierSms(
    applicationId,
    application.lgu_id,
    lgu.courierPhone,
    `Delivery requested: ${business?.business_name ?? "Business"} (${application.reference_number}), owner ${business?.owner?.full_name ?? "Unknown"} (${business?.owner?.phone ?? "no phone on file"}). Pick up the signed permit at the BPLO office for delivery to: ${address || "address not on file"}.`
  );

  await logAuditEvent(supabase, {
    lguId: application.lgu_id,
    applicationId,
    actorRole: null,
    actorLabel: `${business?.owner?.full_name ?? "Applicant"} (Applicant)`,
    action: "delivery_requested",
    summary: `Applicant requested delivery for ${application.reference_number} -- courier notified`,
  });

  return NextResponse.json({ ok: true });
}
