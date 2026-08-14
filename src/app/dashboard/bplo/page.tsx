import { getCurrentStaff, officeIdentity } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { getSignedDocumentUrl } from "@/lib/review-workflow";
import { BUSINESS_PROFILE_COLUMNS, mapBusinessProfile } from "@/lib/business-profile";
import { getLbtCategoryOptions } from "@/lib/lbt-categories";
import { computeApplicationFees, type FeeComputationResult } from "@/lib/fee-engine";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SignOutButton } from "../sign-out-button";
import {
  BuildingIcon, BusinessProfileBlock, Card, CheckIcon, ClockIcon, DashboardTopBar, DecisionButtons, DocumentList,
  EmptyState, InfoIcon, MiniButton, NotesField, PrimaryButton, Row, SectionHead, StatCard, StatGrid, TonePill, UserIcon, WorkflowStepper, peso,
} from "../ui";
import { finalizeAssessment, getApplicationDocuments, markPrinted, markReleased, resubmitToDepartments, setLbtCategory, submitDepartmentDecisionAsBplo, submitInitialReview } from "./actions";

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

  const office = officeIdentity(staff);
  const supabase = await createClient();
  const lgu = await getLguDisplay(supabase, staff.lgu_id);

  const { data: apps } = await supabase
    .from("applications")
    .select(
      `id, application_type, status, submitted_at, form_inputs, business:businesses(${BUSINESS_PROFILE_COLUMNS}, address, owner:owners(full_name))`
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
  const released = all.filter((a) => a.status === "released");

  const deptReviewIds = inDeptReview.map((a) => a.id);
  const roundsByApp = new Map<string, { id: string; round_number: number }>();
  const reviewsByRound = new Map<
    string,
    { id: string; department: string; decision: string; acted_on_behalf: boolean }[]
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
        .select("id, review_round_id, department, decision, acted_on_behalf")
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

  return (
    <>
      <DashboardTopBar
        officeLabel={office.label}
        officeSub={`${lgu.name}, ${lgu.province}`}
        initials={office.initials}
        active="applications"
        applicationsHref={office.homeHref}
        staffHref="/dashboard/staff"
        settingsHref="/dashboard/settings"
        auditHref="/dashboard/audit"
        statsHref="/dashboard/stats"
        rightSlot={<SignOutButton />}
      />

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
                business={biz(a)}
                formInputs={a.form_inputs as { capital_investment?: number | null; gross_sales?: number | null } | null}
                lguId={staff.lgu_id}
                supabase={supabase}
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
                  <div className="mb-3 flex flex-wrap gap-2">
                    {reviews.length === 0 ? (
                      <span className="text-[12.5px] text-ink-faint">Waiting for department assignment.</span>
                    ) : (
                      reviews.map((r) => (
                        <TonePill
                          key={r.department}
                          dot
                          tone={r.decision === "approved" || r.decision === "approved_with_condition" ? "good" : r.decision === "rejected" ? "bad" : r.decision === "request_more_info" ? "info" : "neutral"}
                          label={`${r.department} · ${r.decision.replace(/_/g, " ")}${r.acted_on_behalf ? " (BPLO)" : ""}`}
                        />
                      ))
                    )}
                  </div>

                  {reviews.filter((r) => r.decision === "pending").map((r) => (
                    <form key={r.id} action={submitDepartmentDecisionAsBplo} className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <input type="hidden" name="departmentReviewId" value={r.id} />
                      <span className="mr-1 text-[11px] font-bold text-ink-soft">Act for {r.department}:</span>
                      <DecisionButtons compact />
                    </form>
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
                </Card>
              );
            })}
          </div>
        )}
      </div>

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
                <form action={markPrinted}>
                  <input type="hidden" name="applicationId" value={a.id} />
                  <MiniButton type="submit">Mark as printed</MiniButton>
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
        <div className="mb-9">
          <SectionHead title="Returned to applicant" />
          <Card>
            {returned.map((a) => (
              <div key={a.id} className="flex items-center gap-3 border-b border-border px-4.5 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold text-ink">{businessName(a)}</p>
                  <p className="text-[12px] text-ink-soft">Owner: {ownerName(a)}</p>
                </div>
                <TonePill label="Returned" tone="bad" />
              </div>
            ))}
          </Card>
        </div>
      )}
    </>
  );
}

/**
 * Fee assessment card -- build order step 7. Computes a live preview
 * with the fee engine (src/lib/fee-engine.ts) every time this renders;
 * nothing is written to application_fee_lines until "Finalize
 * assessment" is submitted (finalizeAssessment re-runs the computation
 * server-side rather than trusting this preview). A blocked result
 * (missing LBT category, most commonly) hides the finalize form
 * entirely and links straight to where BPLO can fix it, instead of
 * letting the click fail with a thrown error.
 */
async function AssessmentCard({
  applicationId, businessName, ownerName, applicationType, status, business, formInputs, lguId, supabase,
}: {
  applicationId: string; businessName: string; ownerName: string; applicationType: string; status: string;
  business: (Record<string, unknown> & { id: string }) | null;
  formInputs: { capital_investment?: number | null; gross_sales?: number | null } | null;
  lguId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
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
        },
      })
    : { ok: false, blockedReason: "Business record missing." };

  return (
    <Card className="p-5">
      <p className="mb-1 font-display text-[15px] font-bold text-ink">{businessName}</p>
      <p className="mb-3 text-[12.5px] text-ink-soft">
        Owner: {ownerName} · {applicationType === "new" ? "New" : "Renewal"}
      </p>
      <WorkflowStepper status={status} />

      {!result.ok ? (
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
      ) : (
        <form action={finalizeAssessment}>
          <input type="hidden" name="applicationId" value={applicationId} />
          <div className="mb-3 divide-y divide-border rounded-2xl border border-border">
            {result.lines.map((line) => (
              <div key={line.feeRuleId} className="flex flex-wrap items-center gap-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-bold text-ink">{line.feeRuleName}</p>
                  {!line.includedInTotal && <p className="text-[11px] text-ink-faint">Paid at a physical counter — not part of the online total.</p>}
                  {line.note && <p className="text-[11px] text-warn-ink">{line.note}</p>}
                </div>
                <span className="font-display text-[15px] font-bold tabular-nums text-brand-navy">{peso(line.amount)}</span>
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <input
                    type="number"
                    step="0.01"
                    name={`override_${line.feeRuleId}`}
                    placeholder="Override (₱)"
                    className="h-8 w-28 rounded-lg border border-border-strong bg-surface px-2 text-[12px] text-ink placeholder:text-ink-faint"
                  />
                  <input
                    type="text"
                    name={`overrideReason_${line.feeRuleId}`}
                    placeholder="Reason for override"
                    className="h-8 flex-1 rounded-lg border border-border-strong bg-surface px-2 text-[12px] text-ink placeholder:text-ink-faint"
                  />
                </div>
              </div>
            ))}
          </div>

          {result.warnings.length > 0 && (
            <div className="mb-3 flex flex-col gap-1 rounded-2xl bg-info-bg px-4 py-3 text-[12px] font-bold text-info-ink">
              {result.warnings.map((w, i) => <span key={i}>{w}</span>)}
            </div>
          )}

          <div className="mb-4 flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3">
            <span className="text-[12.5px] font-bold text-ink-soft">Total due online</span>
            <span className="font-display text-[20px] font-bold tabular-nums text-ink">{peso(result.total)}</span>
          </div>

          <PrimaryButton type="submit">Finalize assessment</PrimaryButton>
        </form>
      )}
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
        <form action={setLbtCategory} className="mb-4 flex flex-wrap items-center gap-2">
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

      <DocumentList documents={documents} signedUrls={signedUrls} />

      <form action={submitInitialReview}>
        <input type="hidden" name="applicationId" value={applicationId} />
        <NotesField name="notes" placeholder="Notes (required if requesting info or rejecting)" />
        <DecisionButtons />
      </form>
    </Card>
  );
}
