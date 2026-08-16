import { createClient } from "@/lib/supabase/server";
import { Card, EmptyState, NotesField, OutlineButton, PrimaryButton, WorkflowStepper, peso } from "./ui";
import { recordPayment, requestPaymentInfo } from "./treasury/actions";

type FeeLine = { display_label: string; computed_amount: number; overridden_amount: number | null; included_in_total: boolean; is_manual: boolean };

/**
 * The "awaiting payment" queue -- same query, same cards, same
 * recordPayment action, rendered on both Treasury's own dashboard and
 * (2026-08-15, CLAUDE.md 7v) BPLO's. Extracted into its own file rather
 * than duplicated in both page.tsx files once BPLO also needed it --
 * same reasoning as review-workflow.ts's openDepartmentReviewRound or
 * lbt-categories.ts's setBusinessLbtCategory: one function/component
 * owns a piece of behavior, every caller shares it instead of each
 * running its own near-identical copy.
 *
 * Deliberately does its own targeted query (status = pending_payment,
 * with fee_lines joined) rather than piggybacking on bplo/page.tsx's
 * broader all-applications fetch -- that fetch doesn't join fee_lines at
 * all, and joining it for every application regardless of status would
 * cost more than the second targeted query this adds only for the
 * (usually small) set of applications actually awaiting payment.
 *
 * Visibility policy (show this section at all, hide it when empty, etc.)
 * is each caller's own choice -- this component only ever renders rows
 * or a single EmptyState, nothing about whether it's shown.
 */
export async function AwaitingPaymentSection({ lguId }: { lguId: string }) {
  const supabase = await createClient();
  const { data: apps } = await supabase
    .from("applications")
    .select(
      "id, application_type, status, business:businesses(business_name, legacy_owner_name, owner:owners(full_name)), fee_lines:application_fee_lines(display_label, computed_amount, overridden_amount, included_in_total, is_manual)"
    )
    .eq("lgu_id", lguId)
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
  function feeLines(a: (typeof rows)[number]): FeeLine[] {
    return (a.fee_lines as unknown as FeeLine[]) ?? [];
  }
  function assessedTotal(lines: FeeLine[]): number {
    return lines.filter((l) => l.included_in_total).reduce((sum, l) => sum + (l.overridden_amount ?? l.computed_amount), 0);
  }

  if (rows.length === 0) return <EmptyState>Nothing waiting on payment right now.</EmptyState>;

  return (
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

            <a
              href={`/api/dashboard/order-of-payment?applicationId=${a.id}`}
              target="_blank"
              rel="noreferrer"
              className="mb-3 inline-block rounded-full border border-info px-3.5 py-1.5 text-[12.5px] font-bold text-info hover:bg-info-bg"
            >
              Open Order of Payment
            </a>

            {lines.length === 0 ? (
              <div className="mb-4 rounded-2xl bg-info-bg px-4 py-3 text-[12.5px] font-bold text-info-ink">
                No assessed amount on file for this application — confirm with BPLO before recording payment.
              </div>
            ) : (
              <div className="mb-4 divide-y divide-border rounded-2xl border border-border">
                {lines.map((l, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12.5px]">
                    <span className={l.included_in_total ? "text-ink" : "text-ink-faint"}>
                      {l.display_label}
                      {!l.included_in_total && " (paid at counter)"}
                      {l.is_manual && " (entered manually)"}
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

            {/* Treasury's own "request more info" (2026-08-16) -- e.g.
                asking for a clearer copy of an attachment. Deliberately
                non-blocking: the applicant can still pay while this is
                open, matching how a department's own request never
                blocks the others. Collapsed by default so it doesn't
                compete visually with the primary "Record payment" action. */}
            <details className="mt-3">
              <summary className="cursor-pointer text-[12px] font-bold text-ink-soft">Need something from the applicant first?</summary>
              <form action={requestPaymentInfo} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="applicationId" value={a.id} />
                <NotesField name="notes" placeholder="What do you need, e.g. a clearer copy of the OR or receipt?" required />
                <OutlineButton type="submit" tone="info" className="self-start">Request more info</OutlineButton>
              </form>
            </details>
          </Card>
        );
      })}
    </div>
  );
}
