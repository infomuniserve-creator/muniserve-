import { getPilotLguDisplay } from "@/lib/lgu";
import { ApplyPageClient } from "./ApplyPageClient";

/**
 * A thin Server Component (CLAUDE.md 7n) so the LGU letterhead/subtitle
 * text can come from data instead of a hardcoded "San Miguel" string --
 * the actual wizard (lots of client state) lives in ApplyPageClient.
 * Pilot-LGU placeholder: there's no URL-based LGU routing yet, so this
 * page can't know which LGU an anonymous visitor belongs to on its own
 * (see getPilotLguDisplay's own doc comment).
 *
 * force-dynamic: this page had no server data before and was statically
 * prerendered at build time -- once it reads from the DB, that's the
 * wrong default for two reasons: a build-time LGU edit wouldn't show up
 * until the next deploy, and (caught immediately by a failed build) a
 * transient DB hiccup during `next build` would fail the entire
 * deployment instead of just one page load.
 */
export const dynamic = "force-dynamic";

export default async function ApplyPage() {
  const lgu = await getPilotLguDisplay();
  return <ApplyPageClient lgu={lgu} />;
}
