import { getCurrentStaff, officeIdentity } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "../sign-out-button";
import { Card, ClockIcon, DashboardTopBar, EmptyState, InfoIcon, PrimaryButton, SectionHead, StatCard, StatGrid, WorkflowStepper } from "../ui";
import { recordPayment } from "./actions";

/**
 * Treasury dashboard -- redesigned per the approved design concept.
 * Rule #7: Treasury confirms payment and records an OR number, never
 * adjusts the fee amount -- there's deliberately no way to edit anything
 * here but those two fields plus the amount actually received.
 */
export default async function TreasuryDashboardPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "treasury") redirect("/dashboard");

  const office = officeIdentity(staff);
  const supabase = await createClient();
  const { data: apps } = await supabase
    .from("applications")
    .select(
      "id, application_type, status, business:businesses(business_name, legacy_owner_name, owner:owners(full_name))"
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

  return (
    <>
      <DashboardTopBar
        officeLabel={office.label}
        officeSub="San Miguel, Bulacan"
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
          {rows.map((a) => (
            <Card key={a.id} className="p-5">
              <p className="mb-1 font-display text-[15px] font-bold text-ink">{businessName(a)}</p>
              <p className="mb-3 text-[12.5px] text-ink-soft">
                Owner: {ownerName(a)} · {a.application_type === "new" ? "New" : "Renewal"}
              </p>
              <WorkflowStepper status={a.status} />
              <div className="mb-4 flex items-start gap-2 rounded-2xl bg-info-bg px-4 py-3 text-[12.5px] font-bold text-info-ink">
                <InfoIcon className="mt-0.5 size-4 shrink-0" />
                Automatic fee computation isn&rsquo;t built yet — enter the amount actually collected manually for now.
              </div>
              <form action={recordPayment} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="applicationId" value={a.id} />
                <input name="amount" type="number" step="0.01" placeholder="Amount (₱)" required className="h-9 w-36 rounded-xl border border-border bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint" />
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
          ))}
        </div>
      )}
    </>
  );
}
