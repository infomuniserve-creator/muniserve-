import { resolveLguDisplay } from "@/lib/lgu";
import { headers } from "next/headers";
import { ApplyPageClient } from "./ApplyPageClient";
import { ApplyPausedNotice } from "./paused-notice";

/**
 * A thin Server Component (CLAUDE.md 7n) so the LGU letterhead/subtitle
 * text can come from data instead of a hardcoded "San Miguel" string --
 * the actual wizard (lots of client state) lives in ApplyPageClient.
 *
 * Resolves the real LGU from the request's own subdomain (CLAUDE.md 7o) --
 * a new client's applicants reach this page via their own
 * <subdomain>.muniserve.ph, and resolveLguDisplay() falls back to the
 * pilot LGU (San Miguel) for portal.muniserve.ph/localhost/anything
 * unrecognized. No proxy/middleware file needed -- next/headers already
 * exposes the incoming Host header directly to a Server Component.
 *
 * force-dynamic: this page had no server data before and was statically
 * prerendered at build time -- once it reads from the DB (and now the
 * request's own Host header), that's the wrong default for two reasons:
 * a build-time LGU edit wouldn't show up until the next deploy, and
 * (caught immediately by a failed build) a transient DB hiccup during
 * `next build` would fail the entire deployment instead of just one page
 * load.
 *
 * Paused clients (CLAUDE.md 7o follow-up, migration 0020) never see the
 * wizard at all -- resolveLguDisplay() already includes isPaused, so this
 * is the one place that needs to branch; submit-application/route.ts
 * still rejects a submission outright too, in case a tab was already open
 * before the LGU got paused.
 */
export const dynamic = "force-dynamic";

export default async function ApplyPage() {
  const host = (await headers()).get("host");
  const lgu = await resolveLguDisplay(host);
  if (lgu.isPaused) return <ApplyPausedNotice lgu={lgu} />;
  return <ApplyPageClient lgu={lgu} />;
}
