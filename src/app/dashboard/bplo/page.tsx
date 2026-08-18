import { getCurrentStaff } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { getEngineeringAssessedAmount, getSignedDocumentUrl } from "@/lib/review-workflow";
import { BUSINESS_PROFILE_COLUMNS, mapBusinessProfile } from "@/lib/business-profile";
import { getLbtCategoryOptions } from "@/lib/lbt-categories";
import { computeApplicationFees, type FeeComputationResult, type FeeLineResult } from "@/lib/fee-engine";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  BuildingIcon, BusinessProfileBlock, Card, CheckIcon, ClockIcon, CollapsibleSection, DecisionButtons, DocumentList,
  EmptyState, InfoIcon, MiniButton, NotesField, PrimaryButton, Row, SectionHead, StatCard, StatGrid, TonePill, UserIcon, WorkflowStepper,
} from "../ui";
import { archiveApplication, finalizeAssessment, getApplicationDocuments, markPrinted, markReleased, reopenApplication, resubmitToDepartments, setLbtCategory, submitDepartmentDecisionAsBplo, submitInitialReview } from "./actions";
import type { ManualFieldSpec } from "./assessment-manual-fields";
import { AssessmentLineItems } from "./assessment-line-items";
import { AwaitingPaymentSection } from "../payment-queue";
import { signPermit } from "../mayor/actions";
import { DepartmentReviewActions } from "../department-review-actions";

/**
 * BPLO dashboard -- redesigned per the approved design concept (card-based
 * review queue, workflow stepper, soft rounded everything). Data-fetching
 * logic is unchanged from the build-order-step-6 version; this pass is
 * visual + the new Applications/Businesses nav tab.
 */
export default async function BploDashboardPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "bplo") redirect("/dashboard");

  const supabase = await createClient();
  const lgu = await getLguDisplay(supabase, staff.lgu_id);

  const { data: apps } = await supabase
    .from("applications")
    .select(
      `id, application_type, status, submitted_at, archived_from_status, initial_review_decision, initial_review_notes, form_inputs, business:businesses(${BUSINESS_PROFILE_COLUMNS}, address, owner:owners(full_name))`
    )
    .eq("lgu_id", staff.lgu_id)
    .order("submitted_at", { ascending: true });

  const lbtCategoryOptions = await getLbtCategoryOptions(staff.lgu_id);

  const all = apps ?? [];
  const initial = all.filter((a) => a.status === "pending_bplo_initial");
  const assessment = all.filter((a) => a.status === "pending_bplo_assessment");
  const inDeptReview = all.filter((a) => a.status === "pending_dept_review");
  const awaitingPayment = all.filter((a) => a.status === "pending_payment");
  const printing = all.filter((a) => a.status === "pending_printing");
  const awaitingSignature = all.filter((a) => a.status === "pending_mayor");
  const forRelease = all.filter((a) => a.status === "pending_release");
  const returned = all.filter((a) => a.status === "returned_to_applicant");
  const archived = all.filter((a) => a.status === "archived");
  const released = all.filter((a) => a.status === "released");

  const deptReviewIds = inDeptReview.map((a) => a.id);
  const roundsByApp = new Map<string, { id: string; round_number: number }>();
  const reviewsByRound = new Map<
    string,
    { id: string; department: string; decision: string; acted_on_behalf: boolean; notes: string | null }[]
  >();

  if (deptReviewIds.length > 0) {
    const { data: rounds } = await supabase
      .from("review_rounds")
      .select("id, application_id, round_number")
      .in("application_id", deptReviewIds)
      .order("round_number", { ascending: false });

    for (const r of rounds ?? []) {
      if (!roundsByApp.has(r.application_id)) {
        roundsByApp.set(r.application_id, { id: r.id, round_number: r.round_number });
      }
    }

    const latestRoundIds = Array.from(roundsByApp.values()).map((r) => r.id);
    if (latestRoundIds.length > 0) {
      const { data: reviews } = await supabase
        .from("department_reviews")
        .select("id, review_round_id, department, decision, acted_on_behalf, notes")
        .in("review_round_id", latestRoundIds);

      for (const rv of reviews ?? []) {
        const list = reviewsByRound.get(rv.review_round_id) ?? [];
        list.push(rv);
        reviewsByRound.set(rv.review_round_id, list);
      }
    }
  }

  type BizFields = Record<string, unknown> & {
    id: string;
    business_name: string;
    legacy_owner_name: string | null;
    address: string | null;
    owner: { full_name: string } | null;
  };
  function biz(a: (typeof all)[number]): BizFields | null {
    return a.business as unknown as BizFields | null;
  }
  function ownerName(a: (typeof all)[number]): string {
    const b = biz(a);
    return b?.owner?.full_name ?? b?.legacy_owner_name ?? "Unknown applicant";
  }
  function businessName(a: (typeof all)[number]): string {
    return biz(a)?.business_name ?? "(business record missing)";
  }
  /** Only one of these is ever set, depending on application_type (see submit-application/route.ts). */
  function basisAmount(a: (typeof all)[number]): number | null {
    const inputs = a.form_inputs as { capital_investment?: number | null; gross_sales?: number | null } | null;
    return inputs?.capital_investment ?? inputs?.gross_sales ?? null;
  }

  // Matches WorkflowStepper's own terminology (ui.tsx's STEPS) -- shown
  // next to an archived application so BPLO can see (and Reopen back to)
  // the real stage it was closed out from, now that Archive works from
  // any non-terminal status, not just "Returned to applicant."
  const ARCHIVE_STAGE_LABEL: Record<string, string> = {
    pending_bplo_initial: "Initial review",
    pending_dept_review: "Departments review",
    returned_to_applicant: "Returned to applicant",
    pending_bplo_assessment: "Assessment review",
    pending_payment: "Treasurer approval",
    pending_printing: "For printing",
    pending_mayor: "Mayor's signature",
    pending_release: "For release",
  };

  return (
    <>
      {/*
        Every stage of the pipeline gets a count here, not just the ones
        BPLO directly acts on (Treasurer approval and Mayor's signature
        are shown for visibility even though Treasury/Mayor own those
        actions on their own dashboards -- BPLO is the one office that
        should see the whole thing end to end). Tone reflects what KIND
        of stage it is, not just "pending": warn = BPLO has to make a
        judgment call (approve/reject/assess); info = waiting on someone
        else (departments, Treasury, Mayor) or a simple physical
        confirmation with no judgment involved (printing/release); good =
        done. Eight stages, five real tones -- some overlap is inherent,
        not a mistake.
      */}
      <StatGrid>
        <StatCard label="Initial review" value={initial.length} icon={<ClockIcon />} tone="warn" />
        <StatCard label="In dept. review" value={inDeptReview.length} icon={<BuildingIcon className="size-4" />} tone="info" />
        <StatCard label="Assessment review" value={assessment.length} icon={<ClockIcon />} tone="warn" />
        <StatCard label="Treasurer approval" value={awaitingPayment.length} icon={<ClockIcon />} tone="info" />
        <StatCard label="For printing" value={printing.length} icon={<ClockIcon />} tone="info" />
        <StatCard label="Mayor's signature" value={awaitingSignature.length} icon={<UserIcon className="size-4" />} tone="info" />
        <StatCard label="For release" value={forRelease.length} icon={<ClockIcon />} tone="info" />
        <StatCard label="Released" value={released.length} icon={<CheckIcon />} tone="good" />
      </StatGrid>

      <div className="mb-9">
        <SectionHead title="Needs your review" />
        {initial.length === 0 && assessment.length === 0 ? (
          <EmptyState>Nothing waiting on BPLO right now.</EmptyState>
        ) : (
          <div className="flex flex-col gap-4">
            {initial.map((a) => (
              <InitialReviewCard
                key={a.id}
                applicationId={a.id}
                businessId={biz(a)?.id ?? null}
                businessName={businessName(a)}
                ownerName={ownerName(a)}
                applicationType={a.application_type}
                status={a.status}
                legacyAddress={biz(a)?.address ?? null}
                profile={biz(a) ? mapBusinessProfile(biz(a)!) : null}
                basisAmount={basisAmount(a)}
                lbtCategoryOptions={lbtCategoryOptions}
              />
            ))}
            {assessment.map((a) => (
              <AssessmentCard
                key={a.id}
                applicationId={a.id}
                businessName={businessName(a)}
                ownerName={ownerName(a)}
                applicationType={a.application_type}
                status={a.status}
                conditionNote={a.initial_review_decision === "approved_with_condition" ? a.initial_review_notes : null}
                business={biz(a)}
                formInputs={a.form_inputs as { capital_investment?: number | null; gross_sales?: number | null } | null}
                lguId={staff.lgu_id}
                supabase={supabase}
                automatedAssessmentEnabled={lgu.automatedAssessmentEnabled}
                buildingPermitFeeEnabled={lgu.buildingPermitFeeEnabled}
                buildingPermitFeeLabel={lgu.buildingPermitFeeLabel}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mb-9">
        <SectionHead title="In review across departments" sub="Engineering, MHO, MPDO, BFP, MENRO" />
        {inDeptReview.length === 0 ? (
          <EmptyState>No applications currently with the departments.</EmptyState>
        ) : (
          <div className="flex flex-col gap-4">
            {inDeptReview.map((a) => {
              const round = roundsByApp.get(a.id);
              const reviews = round ? reviewsByRound.get(round.id) ?? [] : [];
              const flagged = reviews.filter((r) => r.decision === "rejected" || r.decision === "request_more_info");
              return (
                <Card key={a.id} className="p-5">
                  <p className="mb-3 font-display text-[15px] font-bold text-ink">
                    {businessName(a)} <span className="font-sans text-[12.5px] font-normal text-ink-soft">· Owner: {ownerName(a)}</span>
                  </p>
                  <WorkflowStepper status={a.status} />

                  {/* Audit finding (2026-08-17): "approved with condition"'s
                      own condition text used to vanish the moment
                      department review opened -- visible nowhere except
                      buried as unstructured JSON in the audit log. */}
                  {a.initial_review_decision === "approved_with_condition" && a.initial_review_notes && (
                    <div className="mb-3 rounded-2xl bg-cond-bg px-4 py-3 text-[12.5px] font-bold text-cond-ink">
                      BPLO&rsquo;s condition: {a.initial_review_notes}
                    </div>
                  )}

                  <div className="mb-3 flex flex-col gap-1.5">
                    {reviews.length === 0 ? (
                      <span className="text-[12.5px] text-ink-faint">Waiting for department assignment.</span>
                    ) : (
                      reviews.map((r) => (
                        <div key={r.department} className="flex flex-wrap items-center gap-2">
                          <TonePill
                            dot
                            tone={r.decision === "approved" || r.decision === "approved_with_condition" ? "good" : r.decision === "rejected" ? "bad" : r.decision === "request_more_info" ? "info" : "neutral"}
                            label={`${r.department} · ${r.decision.replace(/_/g, " ")}${r.acted_on_behalf ? " (BPLO)" : ""}`}
                          />
                          {r.notes && <span className="text-[12px] text-ink-soft">{r.notes}</span>}
                        </div>
                      ))
                    )}
                  </div>

                  {reviews.filter((r) => r.decision === "pending").map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-[11px] font-bold text-ink-soft">Act for {r.department}:</span>
                      <DepartmentReviewActions
                        action={submitDepartmentDecisionAsBplo}
                        departmentReviewId={r.id}
                        department={r.department}
                        buildingPermitFeeEnabled={lgu.buildingPermitFeeEnabled}
                        buildingPermitFeeLabel={lgu.buildingPermitFeeLabel}
                        compact
                      />
                    </div>
                  ))}

                  {flagged.length > 0 && (
                    <form action={resubmitToDepartments} className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-warn-bg px-4 py-3">
                      <input type="hidden" name="applicationId" value={a.id} />
                      {flagged.map((r) => (
                        <input key={r.department} type="hidden" name="departments" value={r.department} />
                      ))}
                      <p className="text-[12.5px] font-bold text-warn-ink">
                        Applicant resubmitted — notify {flagged.map((r) => r.department).join(", ")}
                      </p>
                      <button type="submit" className="rounded-full bg-warn px-4 py-2 text-[12.5px] font-bold text-white hover:bg-[#b87f15]">
                        Notify
                      </button>
                    </form>
                  )}
                  <form action={archiveApplication} className="mt-3">
                    <input type="hidden" name="applicationId" value={a.id} />
                    <MiniButton type="submit" tone="neutral">Archive</MiniButton>
                  </form>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {awaitingPayment.length > 0 && (
        <div className="mb-9">
          <SectionHead
            title="Awaiting payment"
            sub="Normally Treasury's own step — use this only if the applicant already paid at the Treasury counter and brought their OR receipt straight to you."
          />
          <AwaitingPaymentSection lguId={staff.lgu_id} showArchive />
        </div>
      )}

      {printing.length > 0 && (
        <div className="mb-9">
          <SectionHead title="Ready to print" sub="Paid — waiting on the physical permit before it goes to the Mayor" />
          <Card>
            {printing.map((a) => (
              <Row key={a.id}>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold text-ink">{businessName(a)}</p>
                  <p className="text-[12px] text-ink-soft">Owner: {ownerName(a)}</p>
                </div>
                <a
                  href={`/api/dashboard/print-permit?applicationId=${a.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-info px-3.5 py-1.5 text-[12.5px] font-bold text-info hover:bg-info-bg"
                >
                  Open permit
                </a>
                <form action={markPrinted}>
                  <input type="hidden" name="applicationId" value={a.id} />
                  <MiniButton type="submit">Mark as printed</MiniButton>
                </form>
                <form action={archiveApplication}>
                  <input type="hidden" name="applicationId" value={a.id} />
                  <MiniButton type="submit" tone="neutral">Archive</MiniButton>
                </form>
              </Row>
            ))}
          </Card>
        </div>
      )}

      {awaitingSignature.length > 0 && (
        <div className="mb-9">
          <SectionHead
            title="At the Mayor's Office"
            sub="Printed and carried over for signature — mark this once you've brought the signed copy back."
          />
          <Card>
            {awaitingSignature.map((a) => (
              <Row key={a.id}>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold text-ink">{businessName(a)}</p>
                  <p className="text-[12px] text-ink-soft">Owner: {ownerName(a)}</p>
                </div>
                <form action={signPermit}>
                  <input type="hidden" name="applicationId" value={a.id} />
                  <MiniButton type="submit">Mark as signed</MiniButton>
                </form>
                <form action={archiveApplication}>
                  <input type="hidden" name="applicationId" value={a.id} />
                  <MiniButton type="submit" tone="neutral">Archive</MiniButton>
                </form>
              </Row>
            ))}
          </Card>
        </div>
      )}

      {forRelease.length > 0 && (
        <div className="mb-9">
          <SectionHead title="Ready to release" sub="Signed by the Mayor — waiting to be handed to the applicant" />
          <Card>
            {forRelease.map((a) => (
              <Row key={a.id}>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold text-ink">{businessName(a)}</p>
                  <p className="text-[12px] text-ink-soft">Owner: {ownerName(a)}</p>
                </div>
                <form action={markReleased}>
                  <input type="hidden" name="applicationId" value={a.id} />
                  <MiniButton type="submit">Mark as released</MiniButton>
                </form>
              </Row>
            ))}
          </Card>
        </div>
      )}

      {returned.length > 0 && (
        <CollapsibleSection title="Returned to applicant" sub={`${returned.length} waiting on the applicant`}>
          <Card>
            {returned.map((a) => (
              <div key={a.id} className="flex items-center gap-3 border-b border-border px-4.5 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold text-ink">{businessName(a)}</p>
                  <p className="text-[12px] text-ink-soft">Owner: {ownerName(a)}</p>
                </div>
                <TonePill label="Returned" tone="bad" />
                <form action={archiveApplication}>
                  <input type="hidden" name="applicationId" value={a.id} />
                  <MiniButton type="submit" tone="neutral">Archive</MiniButton>
                </form>
              </div>
            ))}
          </Card>
        </CollapsibleSection>
      )}

      {archived.length > 0 && (
        <CollapsibleSection title="Archived" sub={`${archived.length} closed -- applicant confirmed not proceeding`}>
          <Card>
            {archived.map((a) => (
              <div key={a.id} className="flex items-center gap-3 border-b border-border px-4.5 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold text-ink">{businessName(a)}</p>
                  <p className="text-[12px] text-ink-soft">
                    Owner: {ownerName(a)}
                    {a.archived_from_status && ` · was at ${ARCHIVE_STAGE_LABEL[a.archived_from_status] ?? a.archived_from_status}`}
                  </p>
                </div>
                <TonePill label="Archived" tone="neutral" />
                <form action={reopenApplication}>
                  <input type="hidden" name="applicationId" value={a.id} />
                  <MiniButton type="submit" tone="neutral">Reopen</MiniButton>
                </form>
              </div>
            ))}
          </Card>
        </CollapsibleSection>
      )}
    </>
  );
}

// Fixed display order (2026-08-14 follow-up, project owner's explicit
// ask): Mayor's Permit Fee first, Local Business Tax second, then
// whatever regulatory fees are active, CEDULA last (it's reference_only,
// paid at the counter, so it reads naturally as a trailing note rather
// than part of the online total above it). Discount sits right under LBT
// since it's a straight reduction of that line, not its own concept.
// Barangay Clearance (2026-08-17) sits right before CEDULA -- both are
// only sometimes present (CEDULA when reference_only isn't hiding it;
// Barangay Clearance when the applicant asked MuniServe to generate one),
// so grouping them at the tail keeps the always-present lines together up top.
const CATEGORY_ORDER: Record<FeeLineResult["feeCategory"], number> = {
  mayors_permit: 0,
  lbt: 1,
  discount: 2,
  regulatory: 3,
  barangay_clearance: 4,
  cedula: 5,
};

/**
 * Fee assessment card -- build order step 7, generalized 2026-08-14 to a
 * shape-aware engine (fee-engine.ts) plus the Automated Assessment
 * manual-override toggle. Computes a live preview every time this
 * renders; nothing is written to application_fee_lines until "Finalize
 * assessment" is submitted (finalizeAssessment re-runs the computation
 * server-side rather than trusting this preview).
 *
 * A blocked result only still hides the form entirely when Automated
 * Assessment is ON -- off, the blocked reason becomes a warning and the
 * manual-entry section (AssessmentLineItems) renders anyway, since
 * the whole point of that toggle is a way through even when the engine
 * can't compute something.
 */
async function AssessmentCard({
  applicationId, businessName, ownerName, applicationType, status, conditionNote, business, formInputs, lguId, supabase, automatedAssessmentEnabled, buildingPermitFeeEnabled, buildingPermitFeeLabel,
}: {
  applicationId: string; businessName: string; ownerName: string; applicationType: string; status: string;
  conditionNote: string | null;
  business: (Record<string, unknown> & { id: string }) | null;
  formInputs: { capital_investment?: number | null; gross_sales?: number | null } | null;
  lguId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
  automatedAssessmentEnabled: boolean;
  buildingPermitFeeEnabled: boolean;
  buildingPermitFeeLabel: string;
}) {
  const result: FeeComputationResult = business
    ? await computeApplicationFees(supabase, {
        lguId,
        applicationType: applicationType as "new" | "renewal",
        capitalInvestment: formInputs?.capital_investment ?? null,
        grossSales: formInputs?.gross_sales ?? null,
        business: {
          natureOfBusiness: (business.nature_of_business as string | null) ?? null,
          lbtCategory: (business.lbt_category as string | null) ?? null,
          organizationType: (business.organization_type as string | null) ?? null,
          isBranchOffice: (business.is_branch_office as boolean | null) ?? null,
          isAircon: (business.is_aircon as boolean | null) ?? null,
          seatingCapacity: (business.seating_capacity as number | null) ?? null,
          lodgerCount: (business.lodger_count as number | null) ?? null,
          landAreaHectares: (business.land_area_hectares as number | null) ?? null,
          warehouseFloorAreaSqm: (business.warehouse_floor_area_sqm as number | null) ?? null,
          totalFloorAreaSqm: (business.total_floor_area_sqm as string | null) ?? null,
          billiardTableCount: (business.billiard_table_count as number | null) ?? null,
          guardPostCount: (business.guard_post_count as number | null) ?? null,
          animalCount: (business.animal_count as number | null) ?? null,
          maleEmployeeCount: (business.male_employee_count as number | null) ?? null,
          femaleEmployeeCount: (business.female_employee_count as number | null) ?? null,
          barangay: (business.barangay as string | null) ?? null,
          hasBarangayClearance: (business.has_barangay_clearance as string | null) ?? null,
        },
      })
    : { ok: false, blockedReason: "Business record missing." };

  // Blocked and Automated Assessment is on: nothing to do here but send
  // BPLO to fix the underlying data, exactly as before.
  if (!result.ok && automatedAssessmentEnabled) {
    return (
      <Card className="p-5">
        <p className="mb-1 font-display text-[15px] font-bold text-ink">{businessName}</p>
        <p className="mb-3 text-[12.5px] text-ink-soft">
          Owner: {ownerName} · {applicationType === "new" ? "New" : "Renewal"}
        </p>
        <WorkflowStepper status={status} />
        {conditionNote && (
          <div className="mb-3 rounded-2xl bg-cond-bg px-4 py-3 text-[12.5px] font-bold text-cond-ink">
            BPLO&rsquo;s condition: {conditionNote}
          </div>
        )}
        <div className="mb-1 flex items-start gap-2 rounded-2xl bg-warn-bg px-4 py-3 text-[12.5px] font-bold text-warn-ink">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <span>
            {result.blockedReason}
            {business && (
              <>
                {" "}
                <Link href="/dashboard/businesses" className="underline">Open the Business Registry</Link>.
              </>
            )}
          </span>
        </div>
      </Card>
    );
  }

  // Engineering's own computed Building Permit Fee (CLAUDE.md 7aa) --
  // shown in this live preview and actually charged at finalizeAssessment
  // using the exact same lookup, so what BPLO sees here is never a
  // different number than what gets written. Independent of whether the
  // engine itself could compute LBT/Mayor's Permit -- Engineering's
  // figure is real either way, so it's added even when result is blocked
  // (Automated Assessment off, the blocked reason is just a warning here).
  const engineeringAmount = buildingPermitFeeEnabled ? await getEngineeringAssessedAmount(applicationId) : null;
  const engineeringLine: FeeLineResult | null =
    engineeringAmount != null
      ? { feeRuleId: null, feeCategory: "regulatory", displayLabel: buildingPermitFeeLabel, amount: engineeringAmount, includedInTotal: true, isManualEligible: false, acctCode: null }
      : null;

  const baseLines = result.ok ? result.lines : [];
  const rawLines = engineeringLine ? [...baseLines, engineeringLine] : baseLines;
  const lines = [...rawLines].sort((a, b) => CATEGORY_ORDER[a.feeCategory] - CATEGORY_ORDER[b.feeCategory]);
  const warnings = result.ok ? result.warnings : [result.blockedReason];

  const computedLines = lines.filter((l) => automatedAssessmentEnabled || !l.isManualEligible);

  const manualFields: ManualFieldSpec[] = [];
  if (!automatedAssessmentEnabled) {
    for (const category of ["mayors_permit", "lbt"] as const) {
      const line = lines.find((l) => l.feeCategory === category);
      manualFields.push({
        key: `manual_${category}`,
        label: category === "mayors_permit" ? "Mayor's Permit Fee" : "Local Business Tax",
        initial: line?.amount ?? null,
        note: line?.note,
      });
    }
    for (const line of lines.filter((l) => l.feeCategory === "regulatory" && l.isManualEligible)) {
      manualFields.push({ key: `manual_regulatory_${line.feeRuleId}`, label: line.displayLabel, initial: line.amount, note: line.note });
    }
  }

  return (
    <Card className="p-5">
      <p className="mb-1 font-display text-[15px] font-bold text-ink">{businessName}</p>
      <p className="mb-3 text-[12.5px] text-ink-soft">
        Owner: {ownerName} · {applicationType === "new" ? "New" : "Renewal"}
      </p>
      <WorkflowStepper status={status} />

      {conditionNote && (
        <div className="mb-3 rounded-2xl bg-cond-bg px-4 py-3 text-[12.5px] font-bold text-cond-ink">
          BPLO&rsquo;s condition: {conditionNote}
        </div>
      )}

      <form action={finalizeAssessment}>
        <input type="hidden" name="applicationId" value={applicationId} />

        <AssessmentLineItems lines={computedLines} warnings={warnings} automatedAssessmentEnabled={automatedAssessmentEnabled} manualFields={manualFields} />

        <label className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-bold text-ink-soft">Mode of Payment</span>
          <select
            name="modeOfPayment"
            required
            defaultValue=""
            className="h-9 rounded-xl border border-border-strong bg-surface px-2.5 text-[13px] text-ink"
          >
            <option value="" disabled>Select one</option>
            <option value="Annual">Annual</option>
            <option value="Semi-Annual">Semi-Annual</option>
            <option value="Quarterly">Quarterly</option>
          </select>
          <span className="text-[11px] text-ink-faint">Printed on the Order of Payment.</span>
        </label>

        <PrimaryButton type="submit">Finalize assessment</PrimaryButton>
      </form>

      <form action={archiveApplication} className="mt-3">
        <input type="hidden" name="applicationId" value={applicationId} />
        <MiniButton type="submit" tone="neutral">Archive</MiniButton>
      </form>
    </Card>
  );
}

async function InitialReviewCard({
  applicationId, businessId, businessName, ownerName, applicationType, status, legacyAddress, profile, basisAmount, lbtCategoryOptions,
}: {
  applicationId: string; businessId: string | null; businessName: string; ownerName: string; applicationType: string; status: string;
  legacyAddress: string | null; profile: import("../ui").BusinessProfile | null; basisAmount: number | null;
  lbtCategoryOptions: { value: string; label: string }[];
}) {
  const documents = await getApplicationDocuments(applicationId);
  const signedUrls = await Promise.all(documents.map((d) => getSignedDocumentUrl(d.file_url)));

  return (
    <Card className="p-5">
      <p className="mb-1 font-display text-[15px] font-bold text-ink">{businessName}</p>
      <p className="mb-3 text-[12.5px] text-ink-soft">Owner: {ownerName} · {applicationType === "new" ? "New" : "Renewal"}</p>
      <WorkflowStepper status={status} />
      <BusinessProfileBlock legacyAddress={legacyAddress} profile={profile} applicationType={applicationType} basisAmount={basisAmount} />

      {businessId && (
        <form action={setLbtCategory} className="mb-2 flex flex-wrap items-center gap-2">
          <label className="text-[11.5px] font-bold text-ink-soft">LBT category:</label>
          <input type="hidden" name="businessId" value={businessId} />
          <select
            name="lbtCategory"
            defaultValue={profile?.lbtCategory ?? ""}
            className="rounded-xl border border-border-strong bg-surface px-2.5 py-1.5 text-[12.5px] text-ink"
          >
            <option value="">— not set —</option>
            {lbtCategoryOptions.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <MiniButton type="submit">Save</MiniButton>
        </form>
      )}

      {!profile?.lbtCategory && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl bg-warn-bg px-4 py-3 text-[12.5px] font-bold text-warn-ink">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <span>Set the LBT category above before approving — an application can&rsquo;t enter department review without one, or it&rsquo;ll dead-end at Assessment with no way back.</span>
        </div>
      )}

      <DocumentList documents={documents} signedUrls={signedUrls} />

      <a
        href={`/api/dashboard/application-form-pdf?applicationId=${applicationId}`}
        className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-info px-3.5 py-1.5 text-[12.5px] font-bold text-info hover:bg-info-bg"
      >
        Download submitted form (PDF)
      </a>

      <form action={submitInitialReview}>
        <input type="hidden" name="applicationId" value={applicationId} />
        <NotesField name="notes" placeholder="Notes (required if requesting info or rejecting)" />
        <DecisionButtons disableApprove={!profile?.lbtCategory} />
      </form>
    </Card>
  );
}
