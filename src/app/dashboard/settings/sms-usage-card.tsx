import { createClient } from "@/lib/supabase/server";
import { getSmsUsageHistory, SMS_FREE_MONTHLY_LIMIT } from "@/lib/sms-usage";
import { Card } from "../ui";

/**
 * SMS Usage (2026-08-19) -- 1000 free SMS/month per municipality, no
 * carryover, Php 0.55 each over that (the project owner's own real
 * arrangement, not a guessed number). Self-contained data fetching
 * (matching AwaitingPaymentSection's own shape) rather than threading a
 * usage array through settings/page.tsx's already-large prop surface --
 * this card owns "what does SMS usage look like," nothing else needs it.
 *
 * Counts channel='sms' + status='sent' rows in notifications_log,
 * including OTP sends (migration 0054 closed the real gap where those
 * never logged anything at all -- see CLAUDE.md).
 */
export async function SmsUsageCard({ lguId }: { lguId: string }) {
  const supabase = await createClient();
  const months = await getSmsUsageHistory(supabase, lguId, 6);
  const [current, ...previous] = months;

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3.5">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">{current.monthLabel} (this month)</p>
          <p className="font-display text-[24px] font-bold tabular-nums text-ink">
            {current.count.toLocaleString()} <span className="text-[13px] font-bold text-ink-soft">/ {SMS_FREE_MONTHLY_LIMIT.toLocaleString()} free</span>
          </p>
        </div>
        {current.overageCount > 0 ? (
          <div className="text-right">
            <p className="text-[12.5px] font-bold text-warn-ink">{current.overageCount.toLocaleString()} over the free limit</p>
            <p className="text-[11px] text-ink-soft">≈ ₱{current.overageCost.toLocaleString(undefined, { minimumFractionDigits: 2 })} at ₱0.55 each</p>
          </div>
        ) : (
          <p className="text-[12.5px] font-bold text-good-ink">{(SMS_FREE_MONTHLY_LIMIT - current.count).toLocaleString()} remaining this month</p>
        )}
      </div>

      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-faint">Previous months</p>
      {previous.every((m) => m.count === 0) ? (
        <p className="text-[12.5px] text-ink-faint">No SMS history before this month yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-2xl border border-border">
          {previous.map((m) => (
            <div key={m.monthKey} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12.5px]">
              <span className="text-ink">{m.monthLabel}</span>
              <span className="flex items-center gap-2">
                <span className="font-bold tabular-nums text-ink">{m.count.toLocaleString()}</span>
                {m.overageCount > 0 && <span className="text-[11px] font-bold text-warn-ink">+{m.overageCount.toLocaleString()} over (≈ ₱{m.overageCost.toLocaleString(undefined, { minimumFractionDigits: 2 })})</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-ink-faint">Resets to zero on the 1st of every month (unused SMS don&rsquo;t carry over). Counts every text actually sent — OTP codes, status updates, and staff alerts alike.</p>
    </Card>
  );
}
