import { createServiceClient } from "@/lib/supabase/service";

/**
 * Per-IP-address throttle for OTP sends -- the real gap a 2026-08-20 audit
 * confirmed by reading every code path completely: `sendOtpCode()`'s
 * existing cooldown only ever throttled how fast a *new* code could be
 * requested for the same phone number, with nothing stopping one visitor
 * from working through a whole list of different numbers, each a real,
 * billed Semaphore SMS to a real person who never asked for one. This is
 * a coarse, deliberately simple defense layered on top of that existing
 * per-number cooldown, not a replacement for it -- a real rate-limiting
 * service (Upstash, Vercel's own firewall) would be a more scalable fix if
 * volume ever justifies it, but this closes the concrete, confirmed gap
 * with no new infrastructure dependency.
 *
 * Both the threshold and the window are an operational judgment call, not
 * a domain fact requiring confirmation (unlike a fee rate or legal
 * deadline) -- generous enough that a real family sharing one connection
 * or NAT'd office network won't get blocked doing normal sign-ins, tight
 * enough to blunt a scripted burst. Adjustable if it ever needs tuning.
 */
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PER_WINDOW = 5;
const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Returns true if this IP is still under the limit (and records this
 * attempt), false if it should be refused. Fails OPEN, not closed, on any
 * unexpected database error -- a rate-limiter outage must never be able to
 * block every real applicant from signing in, the same "never let a
 * secondary safeguard break the primary flow" reasoning this codebase
 * already applies to notification logging and audit logging.
 */
export async function checkOtpIpRateLimit(ip: string): Promise<boolean> {
  try {
    const supabase = createServiceClient();
    const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

    const { count, error: countError } = await supabase
      .from("otp_rate_limit_events")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", windowStart);
    if (countError) return true;
    if ((count ?? 0) >= MAX_PER_WINDOW) return false;

    await supabase.from("otp_rate_limit_events").insert({ ip });

    // Self-cleaning rather than a separate cron (matching this table's own
    // small expected footprint) -- purges anything old enough that it can
    // no longer affect any real rate-limit window, on a random ~2% of
    // requests so this stays cheap rather than running on every single call.
    if (Math.random() < 0.02) {
      await supabase.from("otp_rate_limit_events").delete().lt("created_at", new Date(Date.now() - RETENTION_MS).toISOString());
    }

    return true;
  } catch {
    return true;
  }
}

/** Vercel sets x-forwarded-for on every real production request; falls back to a fixed bucket key only in environments that don't set it (e.g. local dev), which just means local requests share one shared limit rather than being unthrottled. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
