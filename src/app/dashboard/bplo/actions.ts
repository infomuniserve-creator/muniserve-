"use server";

import { requireUnpausedStaff } from "@/lib/staff";
import { getEngineeringAssessedAmount, openDepartmentReviewRound } from "@/lib/review-workflow";
import { computeApplicationFees } from "@/lib/fee-engine";
import { getLguDisplay } from "@/lib/lgu";
import { notifyApplicantEmail, notifyApplicantSms, notifyStaffByRole } from "@/lib/notifications";
import { actorLabelFor, logAuditEvent } from "@/lib/audit-log";
import { requireLbtCategorySet, setBusinessLbtCategory } from "@/lib/lbt-categories";
import { generateOrderOfPaymentPdf } from "@/lib/order-of-payment-pdf";
import { formatPaymentChannelsForEmailHtml, formatPaymentChannelsForSms, getEnabledPaymentChannels } from "@/lib/payment-methods";
import { createInfoRequest, reopenDepartmentRound } from "@/lib/info-requests";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

type Decision = "approved" | "approved_with_condition" | "request_more_info" | "rejected";

/**
 * BPLO's initial legitimacy review (state machine: pending_bplo_initial ->
 * pending_dept_review or returned_to_applicant). Uses BPLO's own
 * RLS-scoped session for the applications UPDATE (the existing "bplo can
 * update applications at their own lgu" policy from migration 0002
 * already covers this -- no service-role needed there) and for creating
 * the review_rounds/department_reviews rows (migration 0008's new INSERT
 * policy + the existing bplo department_reviews policy). Every active
 * department gets fanned out to at once (rule #4) -- including BFP, which
 * reviews in the same parallel round as everyone else and simply won't
 * approve until it separately sees proof of payment (CLAUDE.md section 7c).
 */
export async function submitInitialReview(formData: FormData) {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const applicationId = String(formData.get("applicationId"));
  const decision = String(formData.get("decision")) as Decision;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const supabase = await createClient();

  // Audit finding (2026-08-17): "Reject" and "Request info" used to be
  // status-identical -- both just sent the application to
  // returned_to_applicant, which loops back for resubmission either way.
  // There was no single action that actually, permanently closed an
  // application at this stage; BPLO had to click Reject, then separately
  // find it and click Archive. A real "Reject" decision now goes straight
  // to archived (the same terminal status/applicant messaging the manual
  // Archive action already established) -- reachable directly from here,
  // not just as a two-step manual follow-up.
  const newStatus =
    decision === "approved" || decision === "approved_with_condition"
      ? "pending_dept_review"
      : decision === "rejected"
        ? "archived"
        : "returned_to_applicant";

  // Gate, not just at Assessment three stages later (2026-08-14 follow-up,
  // after live testing hit exactly that dead end) -- an application can't
  // enter department review at all without an LBT category on file. The
  // real guard is the "Approve" button being disabled client-side
  // (bplo/page.tsx's InitialReviewCard); this is the defense-in-depth
  // backstop against a stale form submitting anyway.
  if (newStatus === "pending_dept_review") {
    const { data: app } = await supabase.from("applications").select("business_id").eq("id", applicationId).single();
    if (app?.business_id) await requireLbtCategorySet(supabase, app.business_id);
  }

  const { data: updated, error: updateError } = await supabase
    .from("applications")
    .update({
      status: newStatus,
      initial_review_decision: decision,
      initial_review_notes: notes,
      initial_review_by: staff.id,
      initial_review_at: new Date().toISOString(),
      // QA sweep finding (2026-08-20): a straight Reject goes to "archived"
      // directly (above), but never recorded WHICH stage it was archived
      // from -- reopenApplication's own fallback (`archived_from_status ??
      // "returned_to_applicant"`) then restored the wrong stage on reopen.
      // Stamped here the same way archiveApplication already does for
      // every other transition into archived.
      ...(newStatus === "archived" ? { archived_from_status: "pending_bplo_initial" } : {}),
    })
    .eq("id", applicationId)
    .eq("status", "pending_bplo_initial")
    .select("reference_number")
    .single();
  if (updateError || !updated) throw updateError ?? new Error("Update failed");

  if (newStatus === "pending_dept_review") {
    await openDepartmentReviewRound(supabase, applicationId, staff.lgu_id);
  } else if (newStatus === "returned_to_applicant") {
    // Closes the "request more info" loop (2026-08-16 follow-up) --
    // previously a dead-end generic SMS with no note shown to the
    // applicant and no way back in short of a phone call. Now the
    // applicant's status page shows this note and an upload box, and
    // uploading auto-requeues straight back into this same queue
    // (info-requests.ts's resolveOpenInfoRequests).
    await createInfoRequest(supabase, {
      applicationId,
      lguId: staff.lgu_id,
      requestedByRole: "bplo_initial",
      notes,
      requestedBy: staff.id,
      actedOnBehalf: false,
      isRejection: false,
      roleLabel: "BPLO",
    });
  } else {
    // newStatus === "archived" (decision === "rejected") -- genuinely
    // terminal now, so no info_requests row: there's nothing left to ask
    // for, and the applicant's status page shows the same "Application
    // closed" message the manual Archive action already uses for this
    // status, not an upload prompt. A direct notification instead of
    // createInfoRequest's own (which assumes there's something to
    // resubmit).
    const { data: app } = await supabase
      .from("applications")
      .select("reference_number, business:businesses(owner:owners(phone, email))")
      .eq("id", applicationId)
      .single();
    const owner = (app?.business as unknown as { owner: { phone: string | null; email: string | null } | null } | null)?.owner;
    const ref = app?.reference_number ?? updated.reference_number;
    if (owner?.phone) {
      await notifyApplicantSms(
        applicationId,
        staff.lgu_id,
        owner.phone,
        `your application ${ref} was rejected by BPLO and is now closed. Visit the BPLO office if you'd like to proceed.`
      );
    }
    if (owner?.email) {
      await notifyApplicantEmail(
        applicationId,
        owner.email,
        `Application rejected: ${ref}`,
        `<p>Your application <strong>${ref}</strong> was rejected by BPLO and is now closed.</p>${notes ? `<p>Reason: ${notes}</p>` : ""}<p>Please visit the BPLO office if you&rsquo;d like to proceed.</p>`
      );
    }
  }

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    applicationId,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action:
      newStatus === "pending_dept_review"
        ? "initial_review_approved"
        : newStatus === "archived"
          ? "initial_review_rejected"
          : "initial_review_returned",
    summary:
      newStatus === "pending_dept_review"
        ? `Initial review approved (${decision}) for ${updated.reference_number}`
        : newStatus === "archived"
          ? `Application ${updated.reference_number} rejected and closed during initial review`
          : `Application ${updated.reference_number} returned to applicant during initial review`,
    details: { decision, notes },
  });

  revalidatePath("/dashboard/bplo");
}

/**
 * BPLO manually confirms an applicant has resubmitted corrections and
 * notifies only the department(s) that flagged an issue (rule #6) -- a
 * new review round with fresh pending rows for just those departments.
 * Departments that already approved in an earlier round aren't touched;
 * their approval keeps counting via areAllDepartmentsCleared's
 * latest-decision-across-rounds logic.
 *
 * A manual fallback/escape hatch, kept alongside the automatic version
 * (info-requests.ts's resolveOpenInfoRequests, triggered the moment the
 * applicant actually uploads a document, 2026-08-16) -- BPLO might still
 * want to re-trigger a department for a reason that has nothing to do
 * with an upload. Both call the same reopenDepartmentRound() so the two
 * paths can't drift apart on what "resubmitted" actually does.
 */
export async function resubmitToDepartments(formData: FormData) {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const applicationId = String(formData.get("applicationId"));
  const departments = formData.getAll("departments").map(String);
  if (departments.length === 0) return;

  const supabase = await createClient();
  await reopenDepartmentRound(supabase, applicationId, staff.lgu_id, departments);

  revalidatePath("/dashboard/bplo");
}

/**
 * Finalizes the fee assessment (pending_bplo_assessment -> pending_payment).
 * Build order step 7's fee engine (src/lib/fee-engine.ts) computes the
 * lines; this action re-runs it server-side rather than trusting anything
 * the form posts back (the page's own preview -- computeApplicationFees
 * called again below, not read from hidden fields -- is what BPLO actually
 * saw, but a client could in principle edit hidden inputs, so only the
 * override_<feeRuleId>/overrideReason_<feeRuleId> fields, the ones meant
 * to be edited, are trusted from the request).
 *
 * Automated Assessment (2026-08-14 follow-up, lgus.automated_assessment_
 * enabled, migration 0026) -- the project owner's own "safe place to go if
 * whatever we design fails": when off, every line the engine flagged
 * `isManualEligible` (Local Business Tax, Mayor's Permit Fee, and any
 * `regulatory` line computed from a non-flat shape) is read from a
 * manual_<feeCategory>/manual_regulatory_<feeRuleId> form field instead of
 * the engine's own computed amount -- required, since the whole point is a
 * human confirming the number, not an empty field silently landing as
 * zero. Everything else (flat regulatory fees, CEDULA, the discount) stays
 * computed exactly as before regardless of the toggle -- nothing about
 * those shapes can be wrong the way a bracket/matrix lookup can.
 *
 * Uses BPLO's own RLS-scoped session to read fee_rules/fee_rule_brackets/
 * businesses/applications/lgus (all already staff-readable); service role
 * only for the application_fee_lines INSERT, since there's no staff insert
 * policy on it at all -- computing/recording the assessment is a system
 * step, not something any role has direct write rights to on their own
 * (rule #7: only BPLO can *override* a line, via overridden_amount, which
 * this does write with the acting BPLO's own staff.id -- a separate
 * mechanism from manual entry, and only offered on lines that stayed
 * computed).
 */
export async function finalizeAssessment(formData: FormData) {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const applicationId = String(formData.get("applicationId"));

  const supabase = await createClient();
  const lgu = await getLguDisplay(supabase, staff.lgu_id);

  const { data: application, error: fetchError } = await supabase
    .from("applications")
    .select(
      `reference_number, application_type, form_inputs, business:businesses(business_name, trade_name, unit_street, city_town, barangay, province, zip_code, address, nature_of_business, lbt_category, organization_type, is_branch_office, is_aircon, seating_capacity, lodger_count, land_area_hectares, warehouse_floor_area_sqm, total_floor_area_sqm, billiard_table_count, guard_post_count, animal_count, male_employee_count, female_employee_count, has_barangay_clearance, business_tax_payment, owner:owners(phone, email, full_name))`
    )
    .eq("id", applicationId)
    .eq("status", "pending_bplo_assessment")
    .single();
  if (fetchError || !application) throw fetchError ?? new Error("Application not found or not awaiting assessment");

  const business = application.business as unknown as {
    business_name: string;
    trade_name: string | null;
    unit_street: string | null;
    city_town: string | null;
    barangay: string | null;
    province: string | null;
    zip_code: string | null;
    address: string | null;
    nature_of_business: string | null;
    lbt_category: string | null;
    organization_type: string | null;
    is_branch_office: boolean | null;
    is_aircon: boolean | null;
    seating_capacity: number | null;
    lodger_count: number | null;
    land_area_hectares: number | null;
    warehouse_floor_area_sqm: number | null;
    total_floor_area_sqm: string | null;
    billiard_table_count: number | null;
    guard_post_count: number | null;
    animal_count: number | null;
    male_employee_count: number | null;
    female_employee_count: number | null;
    has_barangay_clearance: string | null;
    business_tax_payment: string | null;
    owner: { phone: string | null; email: string | null; full_name: string | null } | null;
  } | null;
  if (!business) throw new Error("Business record missing");

  // Mode of Payment is derived straight from the applicant's own
  // Business Tax Payment choice (2026-08-19), not a separate BPLO pick --
  // see AssessmentCard (bplo/page.tsx) for the identical fallback shown
  // in the live preview. Defaults to Annual for a pre-feature application
  // or a walk-in filing that never had a chance to set this (CLAUDE.md:
  // startWalkInApplication doesn't re-collect the ~40-field profile).
  const modeOfPayment = business.business_tax_payment ?? "Annual";

  const formInputs = application.form_inputs as { capital_investment?: number | null; gross_sales?: number | null } | null;

  const result = await computeApplicationFees(supabase, {
    lguId: staff.lgu_id,
    applicationType: application.application_type as "new" | "renewal",
    capitalInvestment: formInputs?.capital_investment ?? null,
    grossSales: formInputs?.gross_sales ?? null,
    business: {
      natureOfBusiness: business.nature_of_business,
      lbtCategory: business.lbt_category,
      organizationType: business.organization_type,
      isBranchOffice: business.is_branch_office,
      isAircon: business.is_aircon,
      seatingCapacity: business.seating_capacity,
      lodgerCount: business.lodger_count,
      landAreaHectares: business.land_area_hectares,
      warehouseFloorAreaSqm: business.warehouse_floor_area_sqm,
      totalFloorAreaSqm: business.total_floor_area_sqm,
      billiardTableCount: business.billiard_table_count,
      guardPostCount: business.guard_post_count,
      animalCount: business.animal_count,
      maleEmployeeCount: business.male_employee_count,
      femaleEmployeeCount: business.female_employee_count,
      barangay: business.barangay,
      hasBarangayClearance: business.has_barangay_clearance,
      businessTaxPayment: business.business_tax_payment,
    },
  });
  // A blocked result is only ever recoverable through manual entry -- with
  // Automated Assessment on, there's nothing else to fall back to.
  if (!result.ok && lgu.automatedAssessmentEnabled) throw new Error(result.blockedReason);
  const computedLines = result.ok ? result.lines : [];

  type FinalLine = {
    feeRuleId: string | null;
    feeCategory: string;
    displayLabel: string;
    amount: number;
    includedInTotal: boolean;
    isManual: boolean;
    acctCode: string | null;
  };

  function readManualAmount(key: string, label: string): number {
    const raw = String(formData.get(key) ?? "").trim();
    if (raw === "" || Number.isNaN(Number(raw))) {
      throw new Error(`"${label}" needs a manually entered amount — Automated Assessment is off for this LGU.`);
    }
    return Number(raw);
  }

  const finalLines: FinalLine[] = [];
  const seenManualCategories = new Set<string>();

  for (const line of computedLines) {
    if (lgu.automatedAssessmentEnabled || !line.isManualEligible) {
      finalLines.push({ feeRuleId: line.feeRuleId, feeCategory: line.feeCategory, displayLabel: line.displayLabel, amount: line.amount, includedInTotal: line.includedInTotal, isManual: false, acctCode: line.acctCode });
      continue;
    }
    const key = line.feeCategory === "regulatory" ? `manual_regulatory_${line.feeRuleId}` : `manual_${line.feeCategory}`;
    if (line.feeCategory === "lbt" || line.feeCategory === "mayors_permit") seenManualCategories.add(line.feeCategory);
    finalLines.push({ feeRuleId: null, feeCategory: line.feeCategory, displayLabel: line.displayLabel, amount: readManualAmount(key, line.displayLabel), includedInTotal: true, isManual: true, acctCode: null });
  }

  // Local Business Tax and Mayor's Permit Fee are mandatory manual entries
  // whenever Automated Assessment is off -- even if the engine found no
  // matching rule at all to compute a starting value from (a blocked
  // result, or no schedule/category matched), BPLO still needs a way
  // through, which is the entire point of this toggle.
  if (!lgu.automatedAssessmentEnabled) {
    for (const [category, label] of [["lbt", "Local Business Tax"], ["mayors_permit", "Mayor's Permit Fee"]] as const) {
      if (seenManualCategories.has(category)) continue;
      finalLines.push({ feeRuleId: null, feeCategory: category, displayLabel: label, amount: readManualAmount(`manual_${category}`, label), includedInTotal: true, isManual: true, acctCode: null });
    }
  }

  // Engineering's own computed Building Permit Fee (CLAUDE.md 7aa) --
  // never part of computeApplicationFees()'s own output (fee-engine.ts
  // has no idea this exists), so it's appended here directly rather than
  // going through the manual-entry-vs-computed branching above. Uses the
  // exact same lookup AssessmentCard's live preview already showed BPLO,
  // so the number that actually gets charged is never a surprise.
  if (lgu.buildingPermitFeeEnabled) {
    const engineeringAmount = await getEngineeringAssessedAmount(applicationId);
    if (engineeringAmount != null) {
      finalLines.push({ feeRuleId: null, feeCategory: "regulatory", displayLabel: lgu.buildingPermitFeeLabel, amount: engineeringAmount, includedInTotal: true, isManual: true, acctCode: null });
    }
  }

  // Barangay Clearance's own guard (2026-08-17) -- direct and toggle-
  // independent, unlike fee-engine.ts's blockedReason mechanism (which a
  // missing Automated Assessment toggle would otherwise let bypass, see
  // fee-engine.ts's own comment on this). Applies regardless of whether
  // Automated Assessment is on or off, since every path through this
  // function (computed, manual fallback, or Engineering) has already run
  // by this point and finalLines is the true final answer.
  if (business.has_barangay_clearance === "No, generate my Brgy. clearance" && !finalLines.some((l) => l.feeCategory === "barangay_clearance")) {
    throw new Error(
      business.barangay
        ? `No Barangay Clearance rate is configured for "${business.barangay}". Set it in Settings before finalizing.`
        : "No Barangay Clearance rate is configured. Set it in Settings before finalizing."
    );
  }

  // Audit finding (2026-08-17): an override used to accept literally
  // anything typed into it -- a stray letter silently became NaN and
  // poisoned the total rather than being rejected, and nothing stopped a
  // negative amount either. Only rejects genuinely nonsensical input
  // (non-numeric, negative) -- deliberately no upper ceiling, since a
  // sane "too large" threshold would just be an invented real-world
  // number this project's own standing rule warns against guessing.
  function parseOverrideAmount(raw: string, label: string): number {
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`The override amount for "${label}" must be a valid, non-negative number.`);
    }
    return amount;
  }

  const lineRows = finalLines.map((line) => {
    let overriddenAmount: number | null = null;
    let overrideReason: string | null = null;
    // Manual entries have nothing to "override" -- the manual amount
    // already is the final figure BPLO chose to charge.
    if (!line.isManual && line.feeRuleId) {
      const overrideRaw = String(formData.get(`override_${line.feeRuleId}`) ?? "").trim();
      overriddenAmount = overrideRaw !== "" ? parseOverrideAmount(overrideRaw, line.displayLabel) : null;
      overrideReason = overriddenAmount != null ? String(formData.get(`overrideReason_${line.feeRuleId}`) ?? "").trim() || null : null;
    }
    return {
      application_id: applicationId,
      fee_rule_id: line.feeRuleId,
      fee_category: line.feeCategory,
      display_label: line.displayLabel,
      is_manual: line.isManual,
      computed_amount: line.amount,
      overridden_amount: overriddenAmount,
      override_reason: overrideReason,
      overridden_by: overriddenAmount != null ? staff.id : null,
      overridden_at: overriddenAmount != null ? new Date().toISOString() : null,
      included_in_total: line.includedInTotal,
      acct_code: line.acctCode,
    };
  });

  const service = createServiceClient();

  // Audit finding (2026-08-17): this status transition used to be the
  // LAST thing this function did, after the application_fee_lines insert
  // -- so two near-simultaneous finalize calls (a double-click before the
  // button disables, two tabs) could both pass the initial fetch's guard,
  // both insert a full duplicate set of fee lines, and only then race on
  // this update, with the loser silently affecting zero rows (no error,
  // since this update never selected/singled its result) while its
  // duplicate fee lines had already been committed. Claiming the status
  // transition FIRST closes this for real: Postgres serializes concurrent
  // UPDATEs against the same row, so only one caller's WHERE clause can
  // ever match, and `.select().single()` makes the loser's zero-row match
  // throw immediately -- before it ever reaches the fee-lines insert.
  //
  // assessment_finalized_at (migration 0022) closes the one gap in an
  // otherwise-complete stage-timestamp timeline -- Performance Stats
  // needs this moment to measure "how long did BPLO take to assess"
  // separately from "how long did the applicant take to pay after."
  const { data: claimed, error: claimError } = await service
    .from("applications")
    .update({
      status: "pending_payment",
      assessment_finalized_at: new Date().toISOString(),
      mode_of_payment: modeOfPayment,
      assessment_finalized_by: staff.id,
    })
    .eq("id", applicationId)
    .eq("status", "pending_bplo_assessment")
    .select("reference_number")
    .single();
  if (claimError || !claimed) throw claimError ?? new Error("This application was already finalized, or isn't awaiting assessment anymore.");

  if (lineRows.length > 0) {
    const { error: insertError } = await service.from("application_fee_lines").insert(lineRows);
    if (insertError) {
      // Compensating rollback -- same "undo what already succeeded if a
      // later step fails" shape as the fee-rule CSV import (CLAUDE.md
      // 7s), since there's no real multi-statement transaction available
      // here. Without this, a failed insert would leave the application
      // sitting at pending_payment with no fee lines to actually show.
      await service
        .from("applications")
        .update({ status: "pending_bplo_assessment", assessment_finalized_at: null, mode_of_payment: null, assessment_finalized_by: null })
        .eq("id", applicationId);
      throw insertError;
    }
  }

  // Business Tax installment reminders (2026-08-19) -- reminder-only, per
  // the project owner's own explicit choice: MuniServe doesn't track or
  // collect the remaining installments online here, it just texts/emails
  // a reminder on each of the LGU's configured dates. Snapshots the exact
  // amount just charged (the LBT line's final amount, override included)
  // rather than re-deriving it later, so a subsequent fee-rule edit can't
  // retroactively change what a reminder claims is due -- same
  // "denormalize at the moment of truth" convention as application_fee_
  // lines' own display_label/acct_code. Best-effort: a scheduling failure
  // here must never undo an assessment that was already finalized and
  // charged, same reasoning as the notification calls below.
  if (modeOfPayment === "Bi-Annually" || modeOfPayment === "Quarterly") {
    const lbtLine = lineRows.find((l) => l.fee_category === "lbt");
    const installmentAmount = lbtLine ? (lbtLine.overridden_amount ?? lbtLine.computed_amount) : null;
    const configuredDates = modeOfPayment === "Bi-Annually" ? lgu.lbtBiannualReminderDates : lgu.lbtQuarterlyReminderDates;
    if (installmentAmount != null && configuredDates.length > 0) {
      const now = new Date();
      const currentYear = now.getFullYear();
      const reminderRows = configuredDates
        .map((mmdd) => {
          const [month, day] = mmdd.split("-").map(Number);
          if (!month || !day) return null;
          // Noon UTC, not midnight -- this project's own established
          // "date-only strings parse at noon UTC" convention
          // (permit-pdf.ts, /verify/[reference]) avoids the exact class
          // of off-by-one-day bug already caught in both of those.
          return new Date(Date.UTC(currentYear, month - 1, day, 12));
        })
        // Only ever schedule dates still ahead of right now -- an
        // application finalized after, say, August has no business
        // "reminding" about an April date that's already passed.
        .filter((d): d is Date => d != null && d.getTime() > now.getTime())
        .map((date) => ({ application_id: applicationId, lgu_id: staff.lgu_id, reminder_date: date.toISOString().slice(0, 10), amount: installmentAmount }));
      if (reminderRows.length > 0) {
        const { error: reminderError } = await service.from("business_tax_reminders").insert(reminderRows);
        if (reminderError) console.error("Could not schedule business tax reminders", reminderError);
      }
    }
  }

  const totalDue = lineRows
    .filter((l) => l.included_in_total)
    .reduce((sum, l) => sum + (l.overridden_amount ?? l.computed_amount), 0);

  // Accepted Payment Methods (2026-08-19) -- one shared derivation, used
  // by both the SMS below and the email/PDF further down, so the two can
  // never describe the payment options differently. See payment-methods.ts.
  const paymentChannels = getEnabledPaymentChannels(lgu);

  if (business.owner?.phone) {
    // Use each line's FINAL amount (override if BPLO set one), not
    // result.total -- that total was computed before overrides, and
    // the applicant needs to know what they actually owe.
    await notifyApplicantSms(
      applicationId,
      staff.lgu_id,
      business.owner.phone,
      `your application ${application.reference_number} has been assessed. Total due: PHP ${totalDue.toLocaleString()}. ${formatPaymentChannelsForSms(paymentChannels)}`
    );
  }

  // Order of Payment email -- a deliberate exception to the "applicants
  // are SMS-only" rule (notifications.ts's own comment on
  // notifyApplicantEmail), since SMS has no way to carry a PDF attachment.
  // Best-effort, same as every other notification here -- an email/PDF
  // failure must never undo the assessment that was just finalized. Only
  // sent when the owner actually has an email on file (not guaranteed,
  // unlike phone).
  if (business.owner?.email) {
    try {
      const structuredAddress = [business.unit_street, business.city_town, business.barangay, business.province, business.zip_code]
        .filter(Boolean)
        .join(", ");
      const orderOfPaymentPdf = await generateOrderOfPaymentPdf({
        referenceNumber: application.reference_number,
        applicationType: application.application_type as "new" | "renewal",
        businessName: business.trade_name || business.business_name,
        ownerName: business.owner.full_name ?? "—",
        address: structuredAddress || business.address || "",
        modeOfPayment: modeOfPayment,
        assessedByName: staff.full_name,
        assessedOn: new Date(),
        lines: lineRows.filter((l) => l.included_in_total).map((l) => ({ acctCode: l.acct_code, displayLabel: l.display_label ?? "", amount: l.overridden_amount ?? l.computed_amount })),
        totalDue,
        lgu,
      });
      await notifyApplicantEmail(
        applicationId,
        business.owner.email,
        `Order of Payment -- ${application.reference_number}`,
        `<p>Your application <strong>${application.reference_number}</strong> has been assessed. Total due: <strong>PHP ${totalDue.toLocaleString()}</strong>.</p><p>The attached Order of Payment lists the full breakdown.</p>${formatPaymentChannelsForEmailHtml(paymentChannels)}`,
        [{ filename: `${application.reference_number}-order-of-payment.pdf`, content: Buffer.from(orderOfPaymentPdf).toString("base64") }]
      );
    } catch (err) {
      console.error("Order of Payment email failed", err);
    }
  }

  // CLAUDE.md 7w -- Treasury previously had no way to know a payment was
  // due except checking their own dashboard cold.
  await notifyStaffByRole(
    staff.lgu_id,
    "treasury",
    applicationId,
    `Payment due: ${application.reference_number}`,
    `<p><strong>${application.reference_number}</strong> has been assessed -- total due ₱${totalDue.toLocaleString()}. Awaiting payment.</p>`,
    `${application.reference_number} assessed -- total due PHP ${totalDue.toLocaleString()}, awaiting payment.`
  );

  const manualCount = lineRows.filter((l) => l.is_manual).length;
  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    applicationId,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "assessment_finalized",
    summary:
      manualCount > 0
        ? `Assessment finalized for ${application.reference_number} -- total due ₱${totalDue.toLocaleString()} (${manualCount} line${manualCount === 1 ? "" : "s"} manually entered, Automated Assessment off)`
        : `Assessment finalized for ${application.reference_number} -- total due ₱${totalDue.toLocaleString()}`,
    details: { totalDue, lineCount: lineRows.length, overrideCount: lineRows.filter((l) => l.overridden_amount != null).length, manualCount },
  });

  revalidatePath("/dashboard/bplo");
  revalidatePath("/dashboard/treasury");
}

/**
 * BPLO confirms the physical permit has been printed (pending_printing ->
 * pending_mayor), ready to go to the Mayor for signature. See CLAUDE.md
 * 7i for why this checkpoint exists at all -- it didn't before, Treasury's
 * payment confirmation used to jump straight to pending_mayor. Uses
 * BPLO's own RLS-scoped session, same as submitInitialReview above.
 */
export async function markPrinted(formData: FormData) {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const applicationId = String(formData.get("applicationId"));
  const supabase = await createClient();

  const { data: updated, error } = await supabase
    .from("applications")
    .update({ status: "pending_mayor", printed_at: new Date().toISOString(), printed_by: staff.id })
    .eq("id", applicationId)
    .eq("status", "pending_printing")
    .select("reference_number")
    .single();
  if (error || !updated) throw error ?? new Error("Update failed");

  // No Mayor notification here (CLAUDE.md 7w follow-up) -- the real
  // process is BPLO physically carries the printed copies to the Mayor's
  // office themselves right after this step, so an SMS/email would just
  // be redundant noise, not new information.
  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    applicationId,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "permit_printed",
    summary: `Permit printed for ${updated.reference_number}, sent to Mayor for signature`,
  });

  revalidatePath("/dashboard/bplo");
}

/**
 * BPLO confirms the signed permit has been handed to the applicant
 * (pending_release -> released) -- the actual final step, separate from
 * the Mayor's signature itself (CLAUDE.md 7i). The permits/permit_history
 * rows were already created at signing (mayor/actions.ts's signPermit);
 * this is just the status flip plus who/when for the audit trail.
 */
export async function markReleased(formData: FormData) {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const applicationId = String(formData.get("applicationId"));
  const supabase = await createClient();

  const { data: updated, error } = await supabase
    .from("applications")
    .update({ status: "released", released_at: new Date().toISOString(), released_by: staff.id })
    .eq("id", applicationId)
    .eq("status", "pending_release")
    .select("reference_number, business:businesses(owner:owners(phone))")
    .single();
  if (error || !updated) throw error ?? new Error("Update failed");

  const business = updated.business as unknown as { owner: { phone: string | null } | null } | null;
  if (business?.owner?.phone) {
    await notifyApplicantSms(
      applicationId,
      staff.lgu_id,
      business.owner.phone,
      `your business permit (${updated.reference_number}) has been released. Thank you for using MuniServe!`
    );
  }

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    applicationId,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "permit_released",
    summary: `Permit released to applicant for ${updated.reference_number}`,
  });

  revalidatePath("/dashboard/bplo");
  revalidatePath("/dashboard/mayor");
  revalidatePath("/dashboard/businesses");
}

/** BPLO can act on any department's behalf (rule #9) -- same shape as a department's own decision, tagged acted_on_behalf. */
export async function submitDepartmentDecisionAsBplo(formData: FormData) {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const assessedAmountRaw = String(formData.get("assessedAmount") ?? "").trim();
  const { submitDepartmentDecision } = await import("@/lib/review-workflow");
  await submitDepartmentDecision({
    departmentReviewId: String(formData.get("departmentReviewId")),
    decision: String(formData.get("decision")) as Decision,
    notes: String(formData.get("notes") ?? "").trim() || null,
    assessedAmount: assessedAmountRaw ? Number(assessedAmountRaw) : null,
    staff,
    actedOnBehalf: true,
  });

  revalidatePath("/dashboard/bplo");
}

/**
 * Manual LBT-category override -- stopgap now that the applicant form no
 * longer asks for this (the real intake form never did either; see
 * reference/official-application-form/README.md). Resolving Nature of
 * Business -> LBT schedule automatically is build order step 7's job; until
 * then, someone has to set businesses.lbt_category by hand or it's
 * permanently null. Uses BPLO's own RLS-scoped session -- migration 0009
 * added the "bplo can update businesses at their own lgu" policy this
 * relies on (businesses previously had no staff write policy at all).
 */
export async function setLbtCategory(formData: FormData) {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const businessId = String(formData.get("businessId"));
  const lbtCategory = String(formData.get("lbtCategory") ?? "").trim() || null;

  const supabase = await createClient();
  await setBusinessLbtCategory(supabase, businessId, lbtCategory);

  revalidatePath("/dashboard/bplo");
}

// Exposed for the BPLO dashboard to look up documents for a given application.
export async function getApplicationDocuments(applicationId: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("documents")
    .select("id, document_type, file_url, uploaded_at")
    .eq("application_id", applicationId)
    .order("uploaded_at", { ascending: false });
  return data ?? [];
}

// Every status Archive can close out from -- every non-terminal stage
// BEFORE a permit is actually issued. Deliberately excludes
// pending_release: the Mayor has already signed by that point (permits/
// permit_history rows exist, CLAUDE.md 7i -- the permit is legally
// issued there, release is just the physical hand-off), so "archived"
// would misleadingly read as "this business doesn't have a permit" when
// they genuinely do. Also excludes the two real terminal statuses
// (released, archived itself) and the dead 'rejected' status value
// (schema-valid, never actually set by any code path, see CLAUDE.md 7oo).
const ARCHIVABLE_STATUSES = new Set([
  "pending_bplo_initial",
  "pending_dept_review",
  "returned_to_applicant",
  "pending_bplo_assessment",
  "pending_payment",
  "pending_printing",
  "pending_mayor",
]);

/**
 * Closes out an application that's never coming back. Originally
 * (2026-08-17, migration 0044) scoped to just "Returned to applicant" --
 * the project owner flagged that queue had no way out except the
 * applicant actually responding, so it just grew forever otherwise
 * (bplo/page.tsx's own query has no date filter). Widened the same day
 * (audit finding, migration 0046) once it was clear the identical
 * "grows forever, no way to close" problem applies to every other
 * non-terminal stage too -- a department round nobody ever finishes, an
 * assessment left half-done, a payment that never comes.
 *
 * A manual action rather than an auto-expiry timeout either way -- this
 * project's standing rule against inventing an unconfirmed real-world
 * number (same reasoning the department-reminder escalation tier is
 * still left unset, CLAUDE.md section 10). No applicant notification --
 * archiving only happens once BPLO has already confirmed by phone or in
 * person that they're not proceeding, so a notification would be
 * redundant.
 *
 * Reads the current status first (rather than a single blind guarded
 * update) specifically so archived_from_status can remember it --
 * reopenApplication needs this to restore the REAL prior stage instead
 * of always assuming returned_to_applicant. The second update re-checks
 * that same status, so a status change racing in between the read and
 * the write still fails safely rather than archiving from a stage BPLO
 * never actually saw.
 */
export async function archiveApplication(formData: FormData) {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const applicationId = String(formData.get("applicationId"));
  const supabase = await createClient();

  const { data: current } = await supabase.from("applications").select("status").eq("id", applicationId).single();
  if (!current || !ARCHIVABLE_STATUSES.has(current.status)) {
    throw new Error("This application can't be archived from its current status.");
  }

  const { data: updated, error } = await supabase
    .from("applications")
    .update({ status: "archived", archived_from_status: current.status })
    .eq("id", applicationId)
    .eq("status", current.status)
    .select("reference_number")
    .single();
  if (error || !updated) throw error ?? new Error("This application's status changed -- refresh and try again.");

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    applicationId,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "application_archived",
    summary: `Archived ${updated.reference_number} (was ${current.status}) -- confirmed the applicant isn't proceeding`,
    details: { archivedFromStatus: current.status },
  });

  revalidatePath("/dashboard/bplo");
}

/**
 * Undoes archiveApplication -- not a one-way door, in case it was
 * archived by mistake or the applicant comes back after all. Restores
 * archived_from_status (2026-08-17, migration 0046) rather than always
 * returned_to_applicant, so an application archived out of, say,
 * pending_payment reopens back into pending_payment, not somewhere it
 * never actually was. Falls back to returned_to_applicant for anything
 * archived before this column existed.
 */
export async function reopenApplication(formData: FormData) {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const applicationId = String(formData.get("applicationId"));
  const supabase = await createClient();

  const { data: current } = await supabase.from("applications").select("archived_from_status").eq("id", applicationId).single();
  const restoreStatus = current?.archived_from_status ?? "returned_to_applicant";

  const { data: updated, error } = await supabase
    .from("applications")
    .update({ status: restoreStatus, archived_from_status: null })
    .eq("id", applicationId)
    .eq("status", "archived")
    .select("reference_number")
    .single();
  if (error || !updated) throw error ?? new Error("Update failed");

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    applicationId,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "application_reopened",
    summary: `Reopened ${updated.reference_number} (back to ${restoreStatus})`,
    details: { restoredToStatus: restoreStatus },
  });

  revalidatePath("/dashboard/bplo");
}
