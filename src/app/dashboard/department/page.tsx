import { getCurrentStaff } from "@/lib/staff";
import { getSignedDocumentUrl } from "@/lib/review-workflow";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "../sign-out-button";
import { Card, EmptyState, SectionLabel, StatCard, StatGrid, TopBar, colors } from "../ui";
import { getApplicationDocuments, submitOwnDepartmentDecision } from "./actions";

/**
 * Department dashboard. Now with real decision buttons (build order step
 * 6). Locked to this staff member's own department (rule #8) -- see the
 * header comment history in git blame for why this page doesn't need to
 * filter by department in the query itself: RLS already does that.
 */
export default async function DepartmentDashboardPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "department" || !staff.department) redirect("/dashboard");

  const supabase = await createClient();

  const { data: pending } = await supabase
    .from("department_reviews")
    .select(
      "id, decision, review_round:review_rounds(application:applications(id, application_type, business:businesses(business_name, legacy_owner_name, owner:owners(full_name))))"
    )
    .eq("decision", "pending")
    .eq("department", staff.department);

  type PendingRow = {
    id: string;
    review_round: {
      application: {
        id: string;
        application_type: string;
        business: { business_name: string; legacy_owner_name: string | null; owner: { full_name: string } | null } | null;
      } | null;
    } | null;
  };
  const rows = (pending ?? []) as unknown as PendingRow[];

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", background: colors.surface2, borderRadius: 16, padding: 24, border: `0.5px solid ${colors.border}` }}>
      <TopBar
        title={`${staff.department} office`}
        subtitle="San Miguel, Bulacan"
        initials={staff.department.slice(0, 2).toUpperCase()}
        bg={colors.proBg}
        fg={colors.proText}
        rightSlot={<SignOutButton />}
      />

      <StatGrid>
        <StatCard label="Awaiting your review" value={rows.length} />
      </StatGrid>

      <SectionLabel>Awaiting your review</SectionLabel>
      {rows.length === 0 ? (
        <Card><EmptyState>Nothing waiting on {staff.department} right now.</EmptyState></Card>
      ) : (
        rows.map((r) => {
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
            />
          );
        })
      )}
    </div>
  );
}

async function DepartmentReviewCard({
  departmentReviewId, applicationId, businessName, ownerName, applicationType,
}: { departmentReviewId: string; applicationId: string; businessName: string; ownerName: string; applicationType: string }) {
  const documents = applicationId ? await getApplicationDocuments(applicationId) : [];
  const signedUrls = await Promise.all(documents.map((d) => getSignedDocumentUrl(d.file_url)));

  return (
    <Card style={{ padding: 12, marginBottom: 10 }}>
      <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 4px" }}>{businessName}</p>
      <p style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 10 }}>
        Owner: {ownerName} · {applicationType === "new" ? "New" : "Renewal"}
      </p>

      <p style={{ fontSize: 11, fontWeight: 500, color: colors.textSecondary, marginBottom: 6 }}>Documents submitted</p>
      {documents.length === 0 ? (
        <p style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 10 }}>No documents uploaded.</p>
      ) : (
        <div style={{ marginBottom: 10 }}>
          {documents.map((d, i) => (
            <div key={d.id} style={{ fontSize: 12, marginBottom: 4 }}>
              {signedUrls[i] ? (
                <a href={signedUrls[i]!} target="_blank" rel="noreferrer" style={{ color: colors.accentText }}>{d.document_type}</a>
              ) : (
                <span>{d.document_type} (link unavailable)</span>
              )}
            </div>
          ))}
        </div>
      )}

      <form action={submitOwnDepartmentDecision}>
        <input type="hidden" name="departmentReviewId" value={departmentReviewId} />
        <textarea name="notes" placeholder="Notes (required if requesting info or rejecting)" style={{ width: "100%", fontSize: 12, padding: 8, borderRadius: 8, border: `0.5px solid ${colors.border}`, marginBottom: 8, minHeight: 50 }} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="submit" name="decision" value="approved" style={actBtnStyle}>Approve</button>
          <button type="submit" name="decision" value="approved_with_condition" style={actBtnStyle}>Approve with condition</button>
          <button type="submit" name="decision" value="request_more_info" style={actBtnStyle}>Request more info</button>
          <button type="submit" name="decision" value="rejected" style={{ ...actBtnStyle, color: colors.dangerText }}>Reject</button>
        </div>
      </form>
    </Card>
  );
}

const actBtnStyle: React.CSSProperties = { fontSize: 12, padding: "6px 10px", borderRadius: 8, border: `0.5px solid ${colors.border}`, background: "#fff", cursor: "pointer" };
