import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * SMS usage counter (2026-08-19, CLAUDE.md) -- the project owner provides
 * 1000 free SMS/month per municipality, no carryover, Php 0.55 each over
 * that. Reads notifications_log (migration 0054 added lgu_id directly on
 * that table, and closed the real gap where OTP sends -- likely the
 * single largest source of real SMS volume -- never logged anything at
 * all). Counts only channel = 'sms' and status = 'sent' -- a "failed" row
 * means sendSms() itself threw before Semaphore ever accepted the
 * message, so it was never actually billed.
 */
export const SMS_FREE_MONTHLY_LIMIT = 1000;
export const SMS_OVERAGE_RATE = 0.55;

export type MonthlySmsUsage = {
  monthKey: string; // "2026-08", stable sort/dedupe key
  monthLabel: string; // "August 2026"
  count: number;
  overageCount: number;
  overageCost: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * `monthsAgo` months back from the current Asia/Manila calendar month
 * (0 = this month). Same "shift now by +8h, read UTC getters as if they
 * were Manila-local fields" technique already established in
 * department-reminders/route.ts, extended here to compute real UTC
 * instant boundaries for the query (shift back by -8h) rather than just
 * a day-of-week check.
 */
function manilaMonthBounds(monthsAgo: number): { start: Date; end: Date; monthKey: string; monthLabel: string } {
  const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
  const phNow = new Date(Date.now() + MANILA_OFFSET_MS);
  const year = phNow.getUTCFullYear();
  const month = phNow.getUTCMonth() - monthsAgo; // Date.UTC normalizes an out-of-range month correctly

  const startShifted = new Date(Date.UTC(year, month, 1));
  const endShifted = new Date(Date.UTC(year, month + 1, 1));
  const start = new Date(startShifted.getTime() - MANILA_OFFSET_MS);
  const end = new Date(endShifted.getTime() - MANILA_OFFSET_MS);

  const monthKey = `${startShifted.getUTCFullYear()}-${String(startShifted.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthLabel = startShifted.toLocaleDateString("en-US", { year: "numeric", month: "long", timeZone: "UTC" });
  return { start, end, monthKey, monthLabel };
}

function toUsage(monthKey: string, monthLabel: string, count: number): MonthlySmsUsage {
  const overageCount = Math.max(0, count - SMS_FREE_MONTHLY_LIMIT);
  return { monthKey, monthLabel, count, overageCount, overageCost: round2(overageCount * SMS_OVERAGE_RATE) };
}

/** Just the current month's count -- for a compact per-row display (e.g. /admin's client list) where a full history query per client would be wasteful. */
export async function getCurrentMonthSmsCount(supabase: SupabaseClient, lguId: string): Promise<number> {
  const { start, end } = manilaMonthBounds(0);
  const { count } = await supabase
    .from("notifications_log")
    .select("id", { count: "exact", head: true })
    .eq("lgu_id", lguId)
    .eq("channel", "sms")
    .eq("status", "sent")
    .gte("sent_at", start.toISOString())
    .lt("sent_at", end.toISOString());
  return count ?? 0;
}

/** Current month plus `monthsOfHistory` previous months, oldest last-shown-first (current month at index 0). */
export async function getSmsUsageHistory(supabase: SupabaseClient, lguId: string, monthsOfHistory = 6): Promise<MonthlySmsUsage[]> {
  const results: MonthlySmsUsage[] = [];
  for (let i = 0; i < monthsOfHistory; i++) {
    const { start, end, monthKey, monthLabel } = manilaMonthBounds(i);
    const { count } = await supabase
      .from("notifications_log")
      .select("id", { count: "exact", head: true })
      .eq("lgu_id", lguId)
      .eq("channel", "sms")
      .eq("status", "sent")
      .gte("sent_at", start.toISOString())
      .lt("sent_at", end.toISOString());
    results.push(toUsage(monthKey, monthLabel, count ?? 0));
  }
  return results;
}
