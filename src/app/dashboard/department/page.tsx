import { getCurrentStaff } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "../sign-out-button";
import { Card, EmptyState, Row, SectionLabel, StatCard, StatGrid, TopBar, colors } from "../ui";

/**
 * Department dashboard -- read-only (see bplo/page.tsx's header comment
 * for why detail panels + decision buttons aren't here yet).
 *
 * Locked to this staff member's own department (CLAUDE.md rule #8). Note
 * this page doesn't need to filter by department in the query at all --
 * RLS's "department scoped access to department_reviews" policy
 * (migration 0002) already does that at the database layer, which is the
 * actual enforcement per rule #8 ("must be enforced at the database
 * layer, not just hidden in the UI"). Querying department_reviews
 * directly for decision = 'pending' also sidesteps needing to figure out
 * "latest round" -- rule #6 means a department only ever has a pending row
 * in the round it's actually supposed to act on; an already-approved
 * department's older round has no bearing on what needs their attention now.
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
      <Card>
        {rows.length === 0 ? (
          <EmptyState>Nothing waiting on {staff.department} right now.</EmptyState>
        ) : (
          rows.map((r) => {
            const app = r.review_round?.application;
            const biz = app?.business;
            const owner = biz?.owner?.full_name ?? biz?.legacy_owner_name ?? "Unknown applicant";
            return (
              <Row key={r.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{biz?.business_name ?? "(business record missing)"}</p>
                  <p style={{ fontSize: 12, color: colors.textSecondary, margin: 0 }}>
                    {owner} · {app?.application_type === "new" ? "New" : "Renewal"}
                  </p>
                </div>
              </Row>
            );
          })
        )}
      </Card>
    </div>
  );
}
