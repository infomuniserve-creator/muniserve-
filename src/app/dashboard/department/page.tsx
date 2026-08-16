import { getCurrentStaff, officeIdentity } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { getSignedDocumentUrl } from "@/lib/review-workflow";
import { BUSINESS_PROFILE_COLUMNS, mapBusinessProfile } from "@/lib/business-profile";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "../sign-out-button";
import { BusinessProfileBlock, Card, ClockIcon, DashboardTopBar, DocumentList, EmptyState, SectionHead, StatCard, StatGrid, WorkflowStepper } from "../ui";
import { DepartmentReviewActions } from "../department-review-actions";
import { getApplicationDocuments, submitOwnDepartmentDecision } from "./actions";

/**
 * Department dashboard -- redesigned per the approved design concept.
 * Data-fetching unchanged from build order step 6; still locked to this
 * staff member's own department (rule #8) via RLS, not a query filter.
 */
export default async function DepartmentDashboardPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "department" || !staff.department) redirect("/dashboard");

  const office = officeIdentity(staff);
  const supabase = await createClient();
  const lgu = await getLguDisplay(supabase, staff.lgu_id);

  const { data: pending } = await supabase
    .from("department_reviews")
    .select(
      `id, decision, review_round:review_rounds(application:applications(id, application_type, status, form_inputs, business:businesses(${BUSINESS_PROFILE_COLUMNS}, address, owner:owners(full_name))))`
    )
    .eq("decision", "pending")
    .eq("department", staff.department);

  type PendingRow = {
    id: string;
    review_round: {
      application: {
        id: string;
        application_type: string;
        status: string;
        form_inputs: { capital_investment?: number | null; gross_sales?: number | null } | null;
        business: (Record<string, unknown> & {
          business_name: string;
          legacy_owner_name: string | null;
          address: string | null;
          owner: { full_name: string } | null;
        }) | null;
      } | null;
    } | null;
  };
  const rows = (pending ?? []) as unknown as PendingRow[];

  return (
    <>
      <DashboardTopBar
        officeLabel={office.label}
        officeSub={`${lgu.name}, ${lgu.province}`}
        initials={office.initials}
        active="applications"
        applicationsHref={office.homeHref}
        rightSlot={<SignOutButton />}
      />

      <StatGrid>
        <StatCard label="Awaiting your review" value={rows.length} icon={<ClockIcon />} tone="warn" />
      </StatGrid>

      <SectionHead title="Awaiting your review" />
      {rows.length === 0 ? (
        <EmptyState>Nothing waiting on {staff.department} right now.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((r) => {
            const app = r.review_round?.application;
            const biz = app?.business;
            const owner = biz?.owner?.full_name ?? biz?.legacy_owner_name ?? "Unknown applicant";
            return (
              <DepartmentReviewCard
                key={r.id}
                departmentReviewId={r.id}
                applicationId={app?.id ?? ""}
                businessName={biz?.business_name ?? "(business record missing)"}
                ownerName={owner}
                applicationType={app?.application_type ?? ""}
                status={app?.status ?? ""}
                legacyAddress={biz?.address ?? null}
                profile={biz ? mapBusinessProfile(biz) : null}
                basisAmount={app?.form_inputs?.capital_investment ?? app?.form_inputs?.gross_sales ?? null}
                department={staff.department ?? ""}
                buildingPermitFeeEnabled={lgu.buildingPermitFeeEnabled}
                buildingPermitFeeLabel={lgu.buildingPermitFeeLabel}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

async function DepartmentReviewCard({
  departmentReviewId, applicationId, businessName, ownerName, applicationType, status, legacyAddress, profile, basisAmount, department, buildingPermitFeeEnabled, buildingPermitFeeLabel,
}: {
  departmentReviewId: string; applicationId: string; businessName: string; ownerName: string; applicationType: string; status: string;
  legacyAddress: string | null; profile: import("../ui").BusinessProfile | null; basisAmount: number | null;
  department: string; buildingPermitFeeEnabled: boolean; buildingPermitFeeLabel: string;
}) {
  const documents = applicationId ? await getApplicationDocuments(applicationId) : [];
  const signedUrls = await Promise.all(documents.map((d) => getSignedDocumentUrl(d.file_url)));

  return (
    <Card className="p-5">
      <p className="mb-1 font-display text-[15px] font-bold text-ink">{businessName}</p>
      <p className="mb-3 text-[12.5px] text-ink-soft">
        Owner: {ownerName} · {applicationType === "new" ? "New" : "Renewal"}
      </p>
      <WorkflowStepper status={status} />
      <BusinessProfileBlock legacyAddress={legacyAddress} profile={profile} applicationType={applicationType} basisAmount={basisAmount} />

      <DocumentList documents={documents} signedUrls={signedUrls} />

      <DepartmentReviewActions
        action={submitOwnDepartmentDecision}
        departmentReviewId={departmentReviewId}
        department={department}
        buildingPermitFeeEnabled={buildingPermitFeeEnabled}
        buildingPermitFeeLabel={buildingPermitFeeLabel}
        showNotes
      />
    </Card>
  );
}
