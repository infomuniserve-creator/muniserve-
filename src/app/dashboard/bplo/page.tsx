import { getCurrentStaff, officeIdentity } from "@/lib/staff";
import { getSignedDocumentUrl } from "@/lib/review-workflow";
import { BUSINESS_PROFILE_COLUMNS, mapBusinessProfile } from "@/lib/business-profile";
import { getLbtCategoryOptions } from "@/lib/lbt-categories";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "../sign-out-button";
import {
  BuildingIcon, BusinessProfileBlock, Card, ClockIcon, DashboardTopBar, DecisionButtons, DocumentList,
  EmptyState, MiniButton, NotesField, PrimaryButton, SectionHead, StatCard, StatGrid, TonePill, WorkflowStepper,
} from "../ui";
import { finalizeAssessment, getApplicationDocuments, resubmitToDepartments, setLbtCategory, submitDepartmentDecisionAsBplo, submitInitialReview } from "./actions";

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
    <div className="mx-auto max-w-3xl">
      <DashboardTopBar
        officeLabel={office.label}
        officeSub="San Miguel, Bulacan"
        initials={office.initials}
        active="applications"
        applicationsHref={office.homeHref}
        rightSlot={<SignOutButton />}
      />

      <StatGrid>
        <StatCard label="Initial review" value={initial.length} icon={<ClockIcon />} tone="warn" />
        <StatCard label="Assessment review" value={assessment.length} icon={<ClockIcon />} tone="warn" />
        <StatCard label="In dept. review" value={inDeptReview.length} icon={<BuildingIcon className="size-4" />} tone="info" />
        <StatCard label="Released" value={released.length} icon={<ClockIcon />} tone="good" />
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
              <Card key={a.id} className="p-5">
                <p className="mb-1 font-display text-[15px] font-bold text-ink">{businessName(a)}</p>
                <p className="mb-3 text-[12.5px] text-ink-soft">
                  Owner: {ownerName(a)} · {a.application_type === "new" ? "New" : "Renewal"}
                </p>
                <WorkflowStepper status={a.status} />
                <div className="mb-4 flex items-start gap-2 rounded-2xl bg-info-bg px-4 py-3 text-[12.5px] font-bold text-info-ink">
                  Automatic fee computation isn&rsquo;t switched on yet — assess the amount manually with the treasury team, then finalize below.
                </div>
                <form action={finalizeAssessment}>
                  <input type="hidden" name="applicationId" value={a.id} />
                  <PrimaryButton type="submit">Finalize assessment</PrimaryButton>
                </form>
              </Card>
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
    </div>
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
