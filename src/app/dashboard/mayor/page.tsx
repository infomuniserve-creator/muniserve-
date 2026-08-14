import { getCurrentStaff, officeIdentity } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "../sign-out-button";
import { Card, CheckIcon, ClockIcon, DashboardTopBar, EmptyState, PrimaryButton, Row, SectionHead, StatCard, StatGrid, TonePill, WorkflowStepper, peso } from "../ui";
import { signPermit } from "./actions";

/**
 * Mayor's signature queue -- redesigned per the approved design concept.
 * Read-only besides the signing action itself, which now hands off to
 * pending_release rather than released -- BPLO handles the actual
 * hand-off to the applicant as its own checkpoint (CLAUDE.md 7i).
 * "Revenue released" sums payments.amount for released applications --
 * the actual amount Treasury recorded as received (rule #7), not the
 * computed assessment.
 */
export default async function MayorDashboardPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "mayor") redirect("/dashboard");

  const office = officeIdentity(staff);
  const supabase = await createClient();
  const lgu = await getLguDisplay(supabase, staff.lgu_id);

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
    <>
      <DashboardTopBar
        officeLabel={office.label}
        officeSub={`${lgu.name}, ${lgu.province}`}
        initials={office.initials}
        active="applications"
        applicationsHref={office.homeHref}
        auditHref="/dashboard/audit"
        statsHref="/dashboard/stats"
        rightSlot={<SignOutButton />}
      />

      <StatGrid>
        <StatCard label="Awaiting signature" value={queue.length} icon={<ClockIcon />} tone="warn" />
        <StatCard label="Released" value={released.length} icon={<CheckIcon />} tone="good" />
        <StatCard label="Revenue released" value={peso(revenueReleased)} icon={<CheckIcon />} tone="good" />
      </StatGrid>

      <div className="mb-9">
        <SectionHead title="Ready for your signature" />
        {queue.length === 0 ? (
          <EmptyState>Nothing waiting on your signature right now.</EmptyState>
        ) : (
          <div className="flex flex-col gap-4">
            {queue.map((a) => (
              <Card key={a.id} className="p-5">
                <p className="mb-1 font-display text-[15px] font-bold text-ink">{businessName(a)}</p>
                <p className="mb-3 text-[12.5px] text-ink-soft">Owner: {ownerName(a)} · Paid {peso(totalPaid(a))}</p>
                <WorkflowStepper status={a.status} />
                <form action={signPermit}>
                  <input type="hidden" name="applicationId" value={a.id} />
                  <PrimaryButton type="submit"><CheckIcon />Sign</PrimaryButton>
                </form>
              </Card>
            ))}
          </div>
        )}
      </div>

      {released.length > 0 && (
        <div>
          <SectionHead title="Recently released" />
          <Card>
            {released.map((a) => (
              <Row key={a.id}>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold text-ink">{businessName(a)}</p>
                  <p className="text-[12px] text-ink-soft">Owner: {ownerName(a)}</p>
                </div>
                <TonePill label="Released" tone="good" />
              </Row>
            ))}
          </Card>
        </div>
      )}
    </>
  );
}
