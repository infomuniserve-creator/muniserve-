"use server";

import { requireUnpausedStaff } from "@/lib/staff";
import { openDepartmentReviewRound } from "@/lib/review-workflow";
import { normalizePhone } from "@/lib/phone";
import { actorLabelFor, logAuditEvent } from "@/lib/audit-log";
import { requireLbtCategorySet, setBusinessLbtCategory } from "@/lib/lbt-categories";
import { BUSINESS_PROFILE_COLUMNS, mapBusinessProfile } from "@/lib/business-profile";
import { TERMINAL_STATUSES } from "@/lib/business-status";
import type { FieldKey } from "@/lib/application-form-logic";
import { getLguDisplay } from "@/lib/lgu";
import { generatePermitAssets } from "@/lib/permit-pdf";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

/**
 * BPLO files a renewal (or a new/reactivation permit) on behalf of a
 * walk-in owner -- the counter-transaction case from the Business
 * Registry design discussion, for someone who shows up in person instead
 * of using the phone-OTP flow themselves. Deliberately minimal compared
 * to the applicant wizard: it doesn't re-collect the ~40-field profile
 * (already on file for every business the registry lists, and editing it
 * is explicitly out of scope for this feature) -- just the one figure
 * that actually changes year to year.
 *
 * Skips pending_bplo_initial and opens the department round immediately
 * -- BPLO is standing at the counter vouching for the physical documents
 * right now, so there's no separate "initial review" left to do.
 * initial_review_* is still recorded, pre-filled as approved, for the
 * same audit trail every other path through this workflow leaves.
 *
 * The phone number is optional. If given, it claims the business exactly
 * like the self-service legacy-claim flow does (find-or-create an owners
 * row, link it) -- without that, a legacy-unclaimed business stays
 * unclaimed even after this filing, since there'd otherwise be no way
 * for the real owner to ever look up their own status by SMS. See
 * business-status.ts for how that interacts with the registry's status
 * classification.
 */
export async function startWalkInApplication(formData: FormData) {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const businessId = String(formData.get("businessId") ?? "");
  const applicationType = String(formData.get("applicationType") ?? "");
  const amount = Number(formData.get("amount"));
  const phoneInput = String(formData.get("phone") ?? "").trim();

  if (!businessId || (applicationType !== "new" && applicationType !== "renewal") || !amount || amount <= 0) {
    throw new Error("Invalid walk-in application");
  }

  const supabase = await createClient();
  const year = new Date().getFullYear();

  const { data: business, error: fetchError } = await supabase
    .from("businesses")
    .select(`${BUSINESS_PROFILE_COLUMNS}, is_legacy_unclaimed, owner_id`)
    .eq("id", businessId)
    .single();
  if (fetchError || !business) throw fetchError ?? new Error("Business not found");

  // Same gate as submitInitialReview (2026-08-14 follow-up) -- a walk-in
  // filing skips the initial-review card entirely (see this function's own
  // doc comment above), so without this check it was the *only* way an
  // application could reach department review with no LBT category set at
  // all, no dropdown ever shown anywhere along the way. Checked before any
  // side effect (owner creation, reference number, application insert)
  // rather than after, so a blocked attempt leaves nothing half-created.
  await requireLbtCategorySet(supabase, businessId);

  const businessUpdate: Record<string, unknown> = {};

  if (applicationType === "renewal") {
    const history = (business.gross_sales_history as Record<string, number> | null) ?? {};
    history[String(year)] = amount;
    businessUpdate.gross_sales_history = history;
  } else {
    // Reactivating a closed business, or filing a first-ever permit for a
    // legacy record that was imported without one.
    businessUpdate.is_active = true;
  }

  if (phoneInput) {
    const phone = normalizePhone(phoneInput);
    if (!phone) throw new Error("That mobile number doesn't look right -- check it and try again.");

    const { data: existingOwner } = await supabase.from("owners").select("id").eq("phone", phone).maybeSingle();
    let ownerId = existingOwner?.id ?? business.owner_id ?? null;
    if (!ownerId) {
      // Client-generated id, no .select() after insert (2026-08-16 follow-up,
      // a real bug caught verifying claimLegacyBusiness below): `owners`'
      // own SELECT policy only allows staff to see an owner already linked
      // to one of their businesses, and Supabase's `.insert().select()` is
      // `INSERT ... RETURNING` under the hood -- Postgres raises an RLS
      // violation on RETURNING a row the SELECT policy would exclude, even
      // though the INSERT itself was allowed. A brand-new owner isn't
      // linked to anything yet at the moment it's created, so this insert
      // was silently failing for every genuinely-new phone number.
      ownerId = crypto.randomUUID();
      const { error: ownerError } = await supabase
        .from("owners")
        .insert({ id: ownerId, full_name: business.legacy_owner_name || phone, phone, claimed_at: new Date().toISOString() });
      if (ownerError) throw ownerError;
    }
    businessUpdate.owner_id = ownerId;
    if (business.is_legacy_unclaimed) businessUpdate.is_legacy_unclaimed = false;
  }

  if (Object.keys(businessUpdate).length > 0) {
    const { error: updateError } = await supabase.from("businesses").update(businessUpdate).eq("id", businessId);
    if (updateError) throw updateError;
  }

  const { data: referenceNumber, error: refError } = await supabase.rpc("generate_application_reference", {
    p_lgu_id: staff.lgu_id,
    p_year: year,
  });
  if (refError || !referenceNumber) throw refError ?? new Error("Reference generation failed");

  const formInputs =
    applicationType === "new"
      ? { capital_investment: amount, gross_sales: null }
      : { capital_investment: null, gross_sales: amount };

  // Walk-ins don't re-collect the ~40-field profile (see this function's
  // own doc comment) -- the snapshot is what was already on file for this
  // business at filing time, which is genuinely what was "submitted" here
  // (BPLO vouching for the physical documents against the existing
  // record), plus the one figure that's specific to this filing.
  const { id: _profileId, lbtCategory: _lbtCategory, ...profileFields } = mapBusinessProfile(business);
  const snapshotFields: Partial<Record<FieldKey, unknown>> = {
    ...(profileFields as Partial<Record<FieldKey, unknown>>),
    capitalInvestment: applicationType === "new" ? amount : undefined,
    grossSales: applicationType === "renewal" ? amount : undefined,
  };
  const formSnapshot = { source: "walkin" as const, fields: snapshotFields };

  const { data: application, error: appError } = await supabase
    .from("applications")
    .insert({
      lgu_id: staff.lgu_id,
      business_id: businessId,
      application_type: applicationType,
      application_year: year,
      status: "pending_dept_review",
      form_inputs: formInputs,
      form_snapshot: formSnapshot,
      reference_number: referenceNumber,
      declaration_accepted_at: new Date().toISOString(),
      initial_review_decision: "approved",
      initial_review_notes: "Filed in person at the BPLO counter — documents verified on the spot.",
      initial_review_by: staff.id,
      initial_review_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (appError || !application) throw appError ?? new Error("Application create failed");

  await openDepartmentReviewRound(supabase, application.id, staff.lgu_id);

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    applicationId: application.id,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "walkin_application_started",
    summary: `Walk-in ${applicationType} application filed at the counter for ${business.business_name ?? "(business record missing)"} -- ${referenceNumber}`,
    details: { applicationType, amount },
  });

  revalidatePath("/dashboard/businesses");
  revalidatePath("/dashboard/bplo");
}

/**
 * LBT-category control on the Business Registry itself (2026-08-14
 * follow-up), not just `bplo/actions.ts`'s copy on the initial-review
 * card. That card is unreachable for any application already past
 * initial review (in department review, or -- the bug that surfaced this
 * -- stuck at Assessment) and for walk-in filings (which never show that
 * card at all, see `startWalkInApplication`'s own comment). The Business
 * Registry is the one page every stuck-for-this-reason application's
 * `fee-engine.ts` blocked message already points BPLO to
 * ("Set it in the Business Registry...") -- this is what makes that link
 * actually true, and it's also the natural place to set it proactively
 * before either flow starts at all, not just to unstick one after the
 * fact.
 */
export async function setLbtCategory(formData: FormData) {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const businessId = String(formData.get("businessId"));
  const lbtCategory = String(formData.get("lbtCategory") ?? "").trim() || null;

  const supabase = await createClient();
  await setBusinessLbtCategory(supabase, businessId, lbtCategory);

  revalidatePath("/dashboard/businesses");
  revalidatePath("/dashboard/bplo");
}

/**
 * BPLO updates the phone number on file for an already-claimed business's
 * owner (2026-08-16 follow-up) -- the real fix for a returning owner who
 * lost access to their registered number between renewal years. Deliberately
 * staff-only, in-person-verified, same trust model this app already uses
 * for every other "prove who you are" moment (walk-in filings, payment/
 * signing on someone's behalf) -- self-service can't safely do this (see
 * lookup-license/route.ts's own doc comment on why License Number alone
 * isn't a safe enough bar once a business is already claimed).
 *
 * Only meaningful for a business that already has an owner; a still-
 * legacy-unclaimed business should go through `claimLegacyBusiness` (or
 * the walk-in form's own phone field, if filing at the same time) instead
 * -- that's a first claim, not an update -- so this throws rather than
 * silently doing something unintended if called on one.
 *
 * Blocks reassigning to a number already registered to a DIFFERENT
 * owner -- a genuine "this is actually the same real person, merge
 * their records" case is rare enough (and `owners.merged_into_owner_id`
 * exists but is unused elsewhere in this codebase) that it's better
 * handled as a deliberate, separate decision than silently allowed here.
 */
export async function updateOwnerPhone(formData: FormData) {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const businessId = String(formData.get("businessId") ?? "");
  const newPhoneInput = String(formData.get("newPhone") ?? "").trim();
  if (!businessId || !newPhoneInput) throw new Error("Invalid request");

  const newPhone = normalizePhone(newPhoneInput);
  if (!newPhone) throw new Error("That mobile number doesn't look right -- check it and try again.");

  const supabase = await createClient();
  const { data: business, error: fetchError } = await supabase
    .from("businesses")
    .select("business_name, owner_id")
    .eq("id", businessId)
    .single();
  if (fetchError || !business) throw fetchError ?? new Error("Business not found");
  if (!business.owner_id) {
    throw new Error("This business has no registered owner yet -- use the walk-in form below to claim it instead.");
  }

  const { data: conflictingOwner } = await supabase
    .from("owners")
    .select("id")
    .eq("phone", newPhone)
    .neq("id", business.owner_id)
    .maybeSingle();
  if (conflictingOwner) {
    throw new Error("That number is already registered to a different owner -- double-check it before saving.");
  }

  const { error: updateError } = await supabase.from("owners").update({ phone: newPhone }).eq("id", business.owner_id);
  if (updateError) throw updateError;

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "owner_phone_updated",
    summary: `Updated registered mobile number for ${business.business_name ?? "(business record missing)"} -- verified in person at the counter`,
    details: { businessId },
  });

  revalidatePath("/dashboard/businesses");
}

/**
 * Detaches a business from its owner entirely -- the counter-mistake case
 * `updateOwnerPhone` can't fix: it only ever changes the phone on the
 * SAME owner, so a business linked to the wrong person outright (wrong
 * owner picked at the counter, or claimed by someone who wasn't actually
 * the business's owner) had no way back to a claimable state at all.
 *
 * Deliberately reuses `is_legacy_unclaimed = true` as the "no owner,
 * available to be (re)claimed" flag rather than adding a new column or a
 * separate un-claim state -- that's already the one thing this flag
 * means everywhere else in the schema (business-status.ts), and setting
 * it here is what makes the existing `claimLegacyBusiness` form
 * (gated on exactly this flag) immediately usable again for the SAME row
 * -- unclaim-then-reclaim-to-a-different-number is the reassign flow,
 * with no separate "reassign" action needed. The one real cosmetic
 * trade-off: a business that was always MuniServe-native (never a real
 * paper import) and gets unclaimed this way will show as "Legacy — not
 * claimed" in the registry afterward, which isn't literally true -- this
 * schema has no other vocabulary for "ownerless, claimable" today, and
 * this is expected to be a rare admin-correction path, not a new column
 * worth adding for one label's accuracy.
 *
 * Blocks unclaiming while any of the business's own applications are
 * still in flight (not in business-status.ts's own TERMINAL_STATUSES) --
 * a live application doesn't depend on businesses.owner_id for its own
 * review workflow (every action keys off application_id), but the
 * applicant's own /status/[reference] page DOES gate on
 * business.owner_id === the signed-in session's ownerId, so unclaiming
 * mid-review would silently lock the real applicant out of their own
 * already-in-progress application's status page.
 */
export async function unclaimBusiness(formData: FormData) {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const businessId = String(formData.get("businessId") ?? "");
  if (!businessId) throw new Error("Invalid request");

  const supabase = await createClient();
  const { data: business, error: fetchError } = await supabase
    .from("businesses")
    .select("business_name, owner_id")
    .eq("id", businessId)
    .single();
  if (fetchError || !business) throw fetchError ?? new Error("Business not found");
  if (!business.owner_id) {
    throw new Error("This business has no owner to unlink.");
  }

  const { data: apps } = await supabase.from("applications").select("status").eq("business_id", businessId);
  if ((apps ?? []).some((a) => !TERMINAL_STATUSES.has(a.status))) {
    throw new Error("This business has an application currently in progress -- wait until it's finished (or archive it) before unlinking the owner.");
  }

  const { error: updateError } = await supabase
    .from("businesses")
    .update({ owner_id: null, is_legacy_unclaimed: true })
    .eq("id", businessId);
  if (updateError) throw updateError;

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "business_unclaimed",
    summary: `Unlinked ${business.business_name ?? "(business record missing)"} from its registered owner -- available to be claimed again`,
    details: { businessId, previousOwnerId: business.owner_id },
  });

  revalidatePath("/dashboard/businesses");
}

/**
 * BPLO attaches a real, verified mobile number to a still-legacy-unclaimed
 * business, with no application involved -- the gap `startWalkInApplication`
 * didn't cover: that form only ever links a phone as a side effect of
 * filing a renewal/new application (requires an amount, submits a real
 * application), so someone who just wants to be set up in the system --
 * e.g. calls in, or stops by, without renewing that same visit -- had no
 * way to do that alone (2026-08-16 follow-up, flagged directly by the
 * project owner). Same claiming logic as that form's own phone branch
 * (find-or-create an owner for the number, link it, clear
 * is_legacy_unclaimed), just without anything else attached to it.
 */
export async function claimLegacyBusiness(formData: FormData) {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const businessId = String(formData.get("businessId") ?? "");
  const phoneInput = String(formData.get("phone") ?? "").trim();
  if (!businessId || !phoneInput) throw new Error("Invalid request");

  const phone = normalizePhone(phoneInput);
  if (!phone) throw new Error("That mobile number doesn't look right -- check it and try again.");

  const supabase = await createClient();
  const { data: business, error: fetchError } = await supabase
    .from("businesses")
    .select("business_name, owner_id, is_legacy_unclaimed, legacy_owner_name")
    .eq("id", businessId)
    .single();
  if (fetchError || !business) throw fetchError ?? new Error("Business not found");
  if (!business.is_legacy_unclaimed || business.owner_id) {
    throw new Error("This business is already linked to an owner -- use the phone update above instead.");
  }

  const { data: existingOwner } = await supabase.from("owners").select("id").eq("phone", phone).maybeSingle();
  let ownerId = existingOwner?.id ?? null;
  if (!ownerId) {
    // Client-generated id, no .select() after insert -- see the matching
    // comment in startWalkInApplication above for why: `owners`' own
    // SELECT policy only allows staff to see an owner already linked to
    // one of their businesses, and a brand-new owner isn't linked to
    // anything at the moment it's created.
    ownerId = crypto.randomUUID();
    const { error: ownerError } = await supabase
      .from("owners")
      .insert({ id: ownerId, full_name: business.legacy_owner_name || phone, phone, claimed_at: new Date().toISOString() });
    if (ownerError) throw ownerError;
  }

  const { error: updateError } = await supabase
    .from("businesses")
    .update({ owner_id: ownerId, is_legacy_unclaimed: false })
    .eq("id", businessId);
  if (updateError) throw updateError;

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "legacy_business_claimed",
    summary: `Linked ${business.business_name ?? "(business record missing)"} to a mobile number at the counter -- no application filed`,
    details: { businessId },
  });

  revalidatePath("/dashboard/businesses");
}

/**
 * Re-renders and re-uploads a signed permit's PDF/QR without touching
 * anything else about it. signPermit's own generation (mayor/actions.ts)
 * is deliberately best-effort -- a renderer/upload failure there must
 * never undo or block a real signature -- which means pdf_url/qr_code_url
 * can stay null forever with no way to retry once that happens. Before
 * this, the applicant's own /status page just permanently fell back to
 * "pick up at the BPLO counter" with no path to ever fix it, and there
 * was no way to regenerate a corrected PDF either (e.g. after fixing a
 * `lgus` display-text typo that had already been baked into the file).
 *
 * BPLO-only. Reuses the exact same generatePermitAssets() call and
 * storage paths signPermit already uses -- `upsert: true` overwrites the
 * existing object at the same path, so this is a true re-render, not a
 * second copy or a new URL to reconcile. Deliberately doesn't touch
 * permit_history (a record of issuance, not of rendering), issued_at, or
 * valid_until -- nothing about the real permit changes, only the artifact.
 * The final permits UPDATE uses the service-role client, matching
 * signPermit's own choice there -- permits has INSERT policies (mayor,
 * migration 0002; bplo-on-behalf, migration 0032) but no staff-scoped
 * UPDATE policy at all.
 */
export async function regeneratePermitPdf(formData: FormData) {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const applicationId = String(formData.get("applicationId"));

  const supabase = await createClient();
  const { data: application, error: fetchError } = await supabase
    .from("applications")
    .select(
      `reference_number, application_type,
       business:businesses(business_name, unit_street, city_town, barangay, province, zip_code, address, nature_of_business, legacy_owner_name, owner:owners(full_name))`
    )
    .eq("id", applicationId)
    .eq("lgu_id", staff.lgu_id)
    .single();
  if (fetchError || !application) throw fetchError ?? new Error("Application not found");

  const service = createServiceClient();
  const { data: permit, error: permitFetchError } = await service
    .from("permits")
    .select("id, issued_at, valid_until")
    .eq("application_id", applicationId)
    .maybeSingle();
  if (permitFetchError || !permit) throw permitFetchError ?? new Error("This application hasn't been signed yet -- nothing to regenerate.");

  const business = application.business as unknown as {
    business_name: string;
    unit_street: string | null;
    city_town: string | null;
    barangay: string | null;
    province: string | null;
    zip_code: string | null;
    address: string | null;
    nature_of_business: string | null;
    legacy_owner_name: string | null;
    owner: { full_name: string } | null;
  } | null;

  const structuredAddress = [business?.unit_street, business?.city_town, business?.barangay, business?.province, business?.zip_code]
    .filter(Boolean)
    .join(", ");
  const address = structuredAddress || business?.address || "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const verifyUrl = `${appUrl}/verify/${application.reference_number}`;

  const lgu = await getLguDisplay(supabase, staff.lgu_id);
  const { pdf, qrPng } = await generatePermitAssets({
    referenceNumber: application.reference_number,
    businessName: business?.business_name ?? "(business record missing)",
    ownerName: business?.owner?.full_name ?? business?.legacy_owner_name ?? "—",
    applicationType: application.application_type as "new" | "renewal",
    natureOfBusiness: business?.nature_of_business ?? null,
    address,
    issuedAt: new Date(permit.issued_at),
    validUntil: permit.valid_until,
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

  const { error: updateError } = await service.from("permits").update({ pdf_url: pdfUrl, qr_code_url: qrCodeUrl }).eq("id", permit.id);
  if (updateError) throw updateError;

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    applicationId,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "permit_pdf_regenerated",
    summary: `Permit PDF regenerated for ${application.reference_number}`,
  });

  revalidatePath("/dashboard/businesses");
}
