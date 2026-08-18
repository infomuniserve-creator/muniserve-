"use server";

import { requireUnpausedStaff } from "@/lib/staff";
import { openDepartmentReviewRound } from "@/lib/review-workflow";
import { normalizePhone } from "@/lib/phone";
import { actorLabelFor, logAuditEvent } from "@/lib/audit-log";
import { requireLbtCategorySet, setBusinessLbtCategory } from "@/lib/lbt-categories";
import { BUSINESS_PROFILE_COLUMNS, mapBusinessProfile } from "@/lib/business-profile";
import type { FieldKey } from "@/lib/application-form-logic";
import { createClient } from "@/lib/supabase/server";
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
