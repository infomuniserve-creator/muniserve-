import { getCurrentStaff, officeIdentity } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "../sign-out-button";
import { ClockIcon, DashboardTopBar, SectionHead, StatCard, StatGrid } from "../ui";
import { AwaitingPaymentSection } from "../payment-queue";

/**
 * Treasury dashboard -- redesigned per the approved design concept.
 * Rule #7: Treasury confirms payment and records an OR number, never
 * adjusts the fee amount -- there's deliberately no way to edit anything
 * here but those two fields plus the amount actually received.
 *
 * The actual queue (query + cards + the recordPayment form) moved to the
 * shared AwaitingPaymentSection (2026-08-15, CLAUDE.md 7v) once BPLO
 * also needed to record a payment on Treasury's behalf for a walk-in
 * applicant -- this page keeps only its own stat-card count query.
 */
export default async function TreasuryDashboardPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "treasury") redirect("/dashboard");

  const office = officeIdentity(staff);
  const supabase = await createClient();
  const lgu = await getLguDisplay(supabase, staff.lgu_id);
  const { count } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("lgu_id", staff.lgu_id)
    .eq("status", "pending_payment");

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
        <StatCard label="Awaiting payment" value={count ?? 0} icon={<ClockIcon />} tone="warn" />
      </StatGrid>

      <SectionHead title="Awaiting payment" />
      <AwaitingPaymentSection lguId={staff.lgu_id} />
    </>
  );
}
