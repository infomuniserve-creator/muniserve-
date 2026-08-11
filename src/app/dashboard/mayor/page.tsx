import { getCurrentStaff } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "../sign-out-button";
import { Badge, Card, EmptyState, Row, SectionLabel, StatCard, StatGrid, TopBar, colors, peso } from "../ui";

/**
 * Mayor's signature queue -- read-only (see bplo/page.tsx's header
 * comment). "Revenue released" sums payments.amount for released
 * applications -- the actual amount Treasury recorded as received
 * (CLAUDE.md rule #7: Treasury confirms payment, never adjusts it), not
 * the computed assessment, since those can differ if BPLO overrode a fee
 * line after the fact.
 */
export default async function MayorDashboardPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "mayor") redirect("/dashboard");

  const supabase = await createClient();

  const { data: apps } = await supabase
    .from("applications")
    .select(
      "id, application_type, status, business:businesses(business_name, legacy_owner_name, owner:owners(full_name)), payments(amount)"
    )
    .eq("lgu_id", staff.lgu_id)
    .in("status", ["pending_mayor", "released"])
    .order("submitted_at", { ascending: true });

  const all = apps ?? [];
  const queue = all.filter((a) => a.status === "pending_mayor");
  const released = all.filter((a) => a.status === "released");

  function totalPaid(a: (typeof all)[number]): number {
    const payments = (a.payments as unknown as { amount: number }[]) ?? [];
    return payments.reduce((sum, p) => sum + Number(p.amount), 0);
  }
  const revenueReleased = released.reduce((sum, a) => sum + totalPaid(a), 0);

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
      <TopBar title="Mayor's office" subtitle="San Miguel, Bulacan" initials="MO" bg={colors.accentBg} fg={colors.accentText} rightSlot={<SignOutButton />} />

      <StatGrid>
        <StatCard label="Awaiting signature" value={queue.length} />
        <StatCard label="Released" value={released.length} />
        <StatCard label="Revenue released" value={peso(revenueReleased)} />
      </StatGrid>

      <SectionLabel>Ready for your signature</SectionLabel>
      <Card>
        {queue.length === 0 ? (
          <EmptyState>Nothing waiting on your signature right now.</EmptyState>
        ) : (
          queue.map((a) => (
            <Row key={a.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{businessName(a)}</p>
                <p style={{ fontSize: 12, color: colors.textSecondary, margin: 0 }}>
                  {ownerName(a)} · Paid {peso(totalPaid(a))}
                </p>
              </div>
              <Badge label="Paid" status="approved" />
            </Row>
          ))
        )}
      </Card>

      {released.length > 0 && (
        <>
          <SectionLabel>Recently released</SectionLabel>
          <Card>
            {released.map((a) => (
              <Row key={a.id}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{businessName(a)}</p>
                  <p style={{ fontSize: 12, color: colors.textSecondary, margin: 0 }}>{ownerName(a)}</p>
                </div>
                <Badge label="Released" status="approved" />
              </Row>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
