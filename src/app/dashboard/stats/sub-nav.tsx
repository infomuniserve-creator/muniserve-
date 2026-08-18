import Link from "next/link";
import { NavLinkPendingHint } from "../pending-ui";

/**
 * Second-level nav within Stats & Reports (2026-08-17, project owner's
 * request -- renamed from "Performance Stats") -- Performance (how fast
 * applications move, unchanged from before) vs. Reports (how much
 * revenue's actually been collected, new). Same route-per-view shape as
 * BusinessesSubNav (Directory vs. Permit History): two different
 * questions, two separate pages with their own server-side data fetching,
 * rather than one page client-side-toggling between two datasets it both
 * fetched up front.
 */
export function StatsSubNav({ active }: { active: "performance" | "reports" }) {
  return (
    <div className="mb-6 flex gap-1.5 border-b border-border">
      <Link
        href="/dashboard/stats"
        className={`-mb-px border-b-2 px-3 pb-2.5 font-display text-[13.5px] font-bold transition-colors ${
          active === "performance" ? "border-brand-navy text-brand-navy" : "border-transparent text-ink-faint hover:text-ink-soft"
        }`}
      >
        Performance
        <NavLinkPendingHint />
      </Link>
      <Link
        href="/dashboard/stats/reports"
        className={`-mb-px border-b-2 px-3 pb-2.5 font-display text-[13.5px] font-bold transition-colors ${
          active === "reports" ? "border-brand-navy text-brand-navy" : "border-transparent text-ink-faint hover:text-ink-soft"
        }`}
      >
        Reports
        <NavLinkPendingHint />
      </Link>
    </div>
  );
}
