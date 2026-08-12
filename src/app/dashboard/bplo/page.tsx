import { getCurrentStaff } from "@/lib/staff";
import { getSignedDocumentUrl } from "@/lib/review-workflow";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "../sign-out-button";
import { Badge, BusinessProfileBlock, Card, EmptyState, Pill, Row, SectionLabel, StatCard, StatGrid, TopBar, colors } from "../ui";
import { finalizeAssessment, getApplicationDocuments, resubmitToDepartments, submitDepartmentDecisionAsBplo, submitInitialReview } from "./actions";

/**
 * BPLO dashboard. Now with real decision buttons (build order step 6) --
 * see actions.ts for the workflow logic itself. Layout still follows
 * reference/MuniServe_Interactive_Prototype.html's BPLO view.
 */
export default async function BploDashboardPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "bplo") redirect("/dashboard");

  const supabase = await createClient();

  const { data: apps } = await supabase
    .from("applications")
    .select(
      "id, application_type, status, submitted_at, form_inputs, business:businesses(business_name, legacy_owner_name, address, nature_of_business, lbt_category, owner:owners(full_name))"
    )
    .eq("lgu_id", staff.lgu_id)
    .order("submitted_at", { ascending: true });

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

  type BizFields = {
    business_name: string;
    legacy_owner_name: string | null;
    address: string | null;
    nature_of_business: string | null;
    lbt_category: string | null;
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
  function basisAmount(a: (typeof all)[number]): number | null {
    const inputs = a.form_inputs as { basis_amount?: number } | null;
    return inputs?.basis_amount ?? null;
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", background: colors.surface2, borderRadius: 16, padding: 24, border: `0.5px solid ${colors.border}` }}>
      <TopBar title="San Miguel, Bulacan" subtitle="BPLO office" initials="SM" bg={colors.accentBg} fg={colors.accentText} rightSlot={<SignOutButton />} />

      <StatGrid>
        <StatCard label="Initial review" value={initial.length} />
        <StatCard label="Assessment review" value={assessment.length} />
        <StatCard label="In dept. review" value={inDeptReview.length} />
        <StatCard label="Released" value={released.length} />
      </StatGrid>

      <SectionLabel>Needs your review</SectionLabel>
      {initial.length === 0 && assessment.length === 0 ? (
        <Card><EmptyState>Nothing waiting on BPLO right now.</EmptyState></Card>
      ) : (
        <>
          {initial.map((a) => (
            <InitialReviewCard
              key={a.id}
              applicationId={a.id}
              businessName={businessName(a)}
              ownerName={ownerName(a)}
              applicationType={a.application_type}
              address={biz(a)?.address ?? null}
              natureOfBusiness={biz(a)?.nature_of_business ?? null}
              lbtCategory={biz(a)?.lbt_category ?? null}
              basisAmount={basisAmount(a)}
            />
          ))}
          {assessment.map((a) => (
            <Card key={a.id} style={{ padding: 12, marginBottom: 10 }}>
              <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 4px" }}>{businessName(a)}</p>
              <p style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 10 }}>Owner: {ownerName(a)} · {a.application_type === "new" ? "New" : "Renewal"}</p>
              <BusinessProfileBlock
                address={biz(a)?.address ?? null}
                natureOfBusiness={biz(a)?.nature_of_business ?? null}
                lbtCategory={biz(a)?.lbt_category ?? null}
                applicationType={a.application_type}
                basisAmount={basisAmount(a)}
              />
              <p style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 10 }}>
                Fee computation engine isn&rsquo;t built yet (build order step 7) — no computed amounts to show. This button only advances the status once you&rsquo;ve assessed the fee manually.
              </p>
              <form action={finalizeAssessment}>
                <input type="hidden" name="applicationId" value={a.id} />
                <button type="submit" style={actBtnStyle}>Finalize assessment</button>
              </form>
            </Card>
          ))}
        </>
      )}

      <SectionLabel>In review across departments</SectionLabel>
      {inDeptReview.length === 0 ? (
        <Card><EmptyState>No applications currently with the departments.</EmptyState></Card>
      ) : (
        inDeptReview.map((a) => {
          const round = roundsByApp.get(a.id);
          const reviews = round ? reviewsByRound.get(round.id) ?? [] : [];
          const flagged = reviews.filter((r) => r.decision === "rejected" || r.decision === "request_more_info");
          return (
            <Card key={a.id} style={{ padding: 12, marginBottom: 10 }}>
              <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 8px" }}>
                {businessName(a)} <span style={{ color: colors.textSecondary, fontWeight: 400 }}>· Owner: {ownerName(a)}</span>
              </p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {reviews.length === 0 ? (
                  <span style={{ fontSize: 12, color: colors.textSecondary }}>Waiting for department assignment.</span>
                ) : (
                  reviews.map((r) => (
                    <Pill
                      key={r.department}
                      label={`${r.department} · ${r.decision.replace(/_/g, " ")}${r.acted_on_behalf ? " (BPLO)" : ""}`}
                      status={r.decision}
                    />
                  ))
                )}
              </div>

              {reviews.filter((r) => r.decision === "pending").map((r) => (
                <form key={r.id} action={submitDepartmentDecisionAsBplo} style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
                  <input type="hidden" name="departmentReviewId" value={r.id} />
                  <span style={{ fontSize: 11, color: colors.textSecondary, alignSelf: "center", marginRight: 4 }}>Act for {r.department}:</span>
                  <button type="submit" name="decision" value="approved" style={smallBtnStyle}>Approve</button>
                  <button type="submit" name="decision" value="approved_with_condition" style={smallBtnStyle}>Approve w/ condition</button>
                  <button type="submit" name="decision" value="request_more_info" style={smallBtnStyle}>Request info</button>
                  <button type="submit" name="decision" value="rejected" style={{ ...smallBtnStyle, color: colors.dangerText }}>Reject</button>
                </form>
              ))}

              {flagged.length > 0 && (
                <form action={resubmitToDepartments} style={{ marginTop: 8 }}>
                  <input type="hidden" name="applicationId" value={a.id} />
                  {flagged.map((r) => (
                    <input key={r.department} type="hidden" name="departments" value={r.department} />
                  ))}
                  <button type="submit" style={actBtnStyle}>
                    Applicant resubmitted — notify {flagged.map((r) => r.department).join(", ")}
                  </button>
                </form>
              )}
            </Card>
          );
        })
      )}

      {returned.length > 0 && (
        <>
          <SectionLabel>Returned to applicant</SectionLabel>
          <Card>
            {returned.map((a) => (
              <Row key={a.id}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{businessName(a)}</p>
                  <p style={{ fontSize: 12, color: colors.textSecondary, margin: 0 }}>Owner: {ownerName(a)}</p>
                </div>
                <Badge label="Returned" status="rejected" />
              </Row>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

async function InitialReviewCard({
  applicationId, businessName, ownerName, applicationType, address, natureOfBusiness, lbtCategory, basisAmount,
}: {
  applicationId: string; businessName: string; ownerName: string; applicationType: string;
  address: string | null; natureOfBusiness: string | null; lbtCategory: string | null; basisAmount: number | null;
}) {
  const documents = await getApplicationDocuments(applicationId);
  const signedUrls = await Promise.all(documents.map((d) => getSignedDocumentUrl(d.file_url)));

  return (
    <Card style={{ padding: 12, marginBottom: 10 }}>
      <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 4px" }}>{businessName}</p>
      <p style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 10 }}>Owner: {ownerName} · {applicationType === "new" ? "New" : "Renewal"}</p>
      <BusinessProfileBlock address={address} natureOfBusiness={natureOfBusiness} lbtCategory={lbtCategory} applicationType={applicationType} basisAmount={basisAmount} />

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

      <form action={submitInitialReview}>
        <input type="hidden" name="applicationId" value={applicationId} />
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
const smallBtnStyle: React.CSSProperties = { fontSize: 11, padding: "4px 8px", borderRadius: 6, border: `0.5px solid ${colors.border}`, background: "#fff", cursor: "pointer" };
