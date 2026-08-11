import { getCurrentStaff } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "../sign-out-button";
import { Badge, Card, EmptyState, Pill, Row, SectionLabel, StatCard, StatGrid, TopBar, colors } from "../ui";

/**
 * BPLO dashboard -- read-only, per CLAUDE.md section 9 build order step 4
 * ("read-only first, no decision buttons yet"). Layout follows
 * reference/MuniServe_Interactive_Prototype.html's BPLO view: stat cards,
 * a combined "needs your review" queue (initial + assessment review,
 * CLAUDE.md rule #9 -- BPLO also sees every department's queue, wired up
 * in the department dashboard once decisions land in a later step), a
 * cross-department pill view for applications currently out for review,
 * and a returned-to-applicant list.
 *
 * Detail panels (documents, department review log, decision buttons) are
 * deferred until the review workflow (build order step 5) actually
 * produces applications to act on -- right now this proves the
 * auth + RLS + data plumbing works, with real (currently empty) queries.
 */
export default async function BploDashboardPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "bplo") redirect("/dashboard");

  const supabase = await createClient();

  const { data: apps } = await supabase
    .from("applications")
    .select(
      "id, application_type, status, submitted_at, business:businesses(business_name, legacy_owner_name, owner:owners(full_name))"
    )
    .eq("lgu_id", staff.lgu_id)
    .order("submitted_at", { ascending: true });

  const all = apps ?? [];
  const initial = all.filter((a) => a.status === "pending_bplo_initial");
  const assessment = all.filter((a) => a.status === "pending_bplo_assessment");
  const inDeptReview = all.filter((a) => a.status === "pending_dept_review");
  const returned = all.filter((a) => a.status === "returned_to_applicant");
  const released = all.filter((a) => a.status === "released");

  // Latest review round + department decisions for applications out for review.
  const deptReviewIds = inDeptReview.map((a) => a.id);
  let roundsByApp = new Map<string, { id: string; round_number: number }>();
  let reviewsByRound = new Map<string, { department: string; decision: string; acted_on_behalf: boolean }[]>();

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
        .select("review_round_id, department, decision, acted_on_behalf")
        .in("review_round_id", latestRoundIds);

      for (const rv of reviews ?? []) {
        const list = reviewsByRound.get(rv.review_round_id) ?? [];
        list.push(rv);
        reviewsByRound.set(rv.review_round_id, list);
      }
    }
  }

  function ownerName(a: (typeof all)[number]): string {
    const biz = a.business as unknown as { legacy_owner_name: string | null; owner: { full_name: string } | null } | null;
    return biz?.owner?.full_name ?? biz?.legacy_owner_name ?? "Unknown applicant";
  }
  function businessName(a: (typeof all)[number]): string {
    const biz = a.business as unknown as { business_name: string } | null;
    return biz?.business_name ?? "(business record missing)";
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
      <Card>
        {initial.length === 0 && assessment.length === 0 ? (
          <EmptyState>Nothing waiting on BPLO right now.</EmptyState>
        ) : (
          <>
            {initial.map((a) => (
              <Row key={a.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{businessName(a)}</p>
                  <p style={{ fontSize: 12, color: colors.textSecondary, margin: 0 }}>
                    {ownerName(a)} · {a.application_type === "new" ? "New" : "Renewal"}
                  </p>
                </div>
                <Badge label="Initial review" status="pending" />
              </Row>
            ))}
            {assessment.map((a) => (
              <Row key={a.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{businessName(a)}</p>
                  <p style={{ fontSize: 12, color: colors.textSecondary, margin: 0 }}>
                    {ownerName(a)} · {a.application_type === "new" ? "New" : "Renewal"}
                  </p>
                </div>
                <Badge label="Assessment review" status="approved_with_condition" />
              </Row>
            ))}
          </>
        )}
      </Card>

      <SectionLabel>In review across departments</SectionLabel>
      {inDeptReview.length === 0 ? (
        <Card><EmptyState>No applications currently with the departments.</EmptyState></Card>
      ) : (
        inDeptReview.map((a) => {
          const round = roundsByApp.get(a.id);
          const reviews = round ? reviewsByRound.get(round.id) ?? [] : [];
          return (
            <Card key={a.id} style={{ padding: 12, marginBottom: 10 }}>
              <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 8px" }}>
                {businessName(a)} <span style={{ color: colors.textSecondary, fontWeight: 400 }}>· {ownerName(a)}</span>
              </p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
                  <p style={{ fontSize: 12, color: colors.textSecondary, margin: 0 }}>{ownerName(a)}</p>
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
