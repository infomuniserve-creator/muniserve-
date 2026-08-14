import { getCurrentStaff, officeIdentity } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "../sign-out-button";
import { Card, ClockIcon, DashboardTopBar, EmptyState, PrimaryButton, SectionHead, StatCard, StatGrid, WorkflowStepper, peso } from "../ui";
import { recordPayment } from "./actions";

/**
 * Treasury dashboard -- redesigned per the approved design concept.
 * Rule #7: Treasury confirms payment and records an OR number, never
 * adjusts the fee amount -- there's deliberately no way to edit anything
 * here but those two fields plus the amount actually received.
 *
 * Now shows the real assessed breakdown (build order step 7's fee
 * engine, finalized by BPLO into application_fee_lines) instead of a
 * blind manual-entry field -- the amount input is still free-text and
 * still required (a business could legitimately pay less/more than
 * assessed), it's just pre-filled with what's actually owed instead of
 * asking Treasury to know that from memory.
 */
export default async function TreasuryDashboardPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "treasury") redirect("/dashboard");

  const office = officeIdentity(staff);
  const supabase = await createClient();
  const lgu = await getLguDisplay(supabase, staff.lgu_id);
  const { data: apps } = await supabase
    .from("applications")
    .select(
      "id, application_type, status, business:businesses(business_name, legacy_owner_name, owner:owners(full_name)), fee_lines:application_fee_lines(computed_amount, overridden_amount, included_in_total, fee_rule:fee_rules(name))"
    )
    .eq("lgu_id", staff.lgu_id)
    .eq("status", "pending_payment")
    .order("submitted_at", { ascending: true });

  const rows = apps ?? [];

  function ownerName(a: (typeof rows)[number]): string {
    const biz = a.business as unknown as { legacy_owner_name: string | null; owner: { full_name: string } | null } | null;
    return biz?.owner?.full_name ?? biz?.legacy_owner_name ?? "Unknown applicant";
  }
  function businessName(a: (typeof rows)[number]): string {
    const biz = a.business as unknown as { business_name: string } | null;
    return biz?.business_name ?? "(business record missing)";
  }
  type FeeLine = { computed_amount: number; overridden_amount: number | null; included_in_total: boolean; fee_rule: { name: string } | null };
  function feeLines(a: (typeof rows)[number]): FeeLine[] {
    return (a.fee_lines as unknown as FeeLine[]) ?? [];
  }
  function assessedTotal(lines: FeeLine[]): number {
    return lines.filter((l) => l.included_in_total).reduce((sum, l) => sum + (l.overridden_amount ?? l.computed_amount), 0);
  }

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
        <StatCard label="Awaiting payment" value={rows.length} icon={<ClockIcon />} tone="warn" />
      </StatGrid>

      <SectionHead title="Awaiting payment" />
      {rows.length === 0 ? (
        <EmptyState>Nothing waiting on payment right now.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((a) => {
            const lines = feeLines(a);
            const total = assessedTotal(lines);
            return (
              <Card key={a.id} className="p-5">
                <p className="mb-1 font-display text-[15px] font-bold text-ink">{businessName(a)}</p>
                <p className="mb-3 text-[12.5px] text-ink-soft">
                  Owner: {ownerName(a)} · {a.application_type === "new" ? "New" : "Renewal"}
                </p>
                <WorkflowStepper status={a.status} />

                {lines.length === 0 ? (
                  <div className="mb-4 rounded-2xl bg-info-bg px-4 py-3 text-[12.5px] font-bold text-info-ink">
                    No assessed amount on file for this application — confirm with BPLO before recording payment.
                  </div>
                ) : (
                  <div className="mb-4 divide-y divide-border rounded-2xl border border-border">
                    {lines.map((l, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12.5px]">
                        <span className={l.included_in_total ? "text-ink" : "text-ink-faint"}>
                          {l.fee_rule?.name ?? "Fee"}
                          {!l.included_in_total && " (paid at counter)"}
                        </span>
                        <span className="font-bold tabular-nums">{peso(l.overridden_amount ?? l.computed_amount)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-3 bg-surface-2 px-4 py-3">
                      <span className="text-[12.5px] font-bold text-ink-soft">Assessed total</span>
                      <span className="font-display text-[17px] font-bold tabular-nums text-brand-navy">{peso(total)}</span>
                    </div>
                  </div>
                )}

                <form action={recordPayment} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="applicationId" value={a.id} />
                  <input
                    name="amount"
                    type="number"
                    step="0.01"
                    placeholder="Amount (₱)"
                    defaultValue={total > 0 ? total : undefined}
                    required
                    className="h-9 w-36 rounded-xl border border-border bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
                  />
                  <select name="method" defaultValue="Cash" className="h-9 rounded-xl border border-border bg-surface px-3 text-[13px] text-ink">
                    <option>Cash</option>
                    <option>GCash</option>
                    <option>Bank Transfer</option>
                    <option>Check</option>
                  </select>
                  <input name="orNumber" placeholder="OR number" required className="h-9 w-36 rounded-xl border border-border bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint" />
                  <PrimaryButton type="submit">Record payment</PrimaryButton>
                </form>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
