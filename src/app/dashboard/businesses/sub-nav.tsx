import Link from "next/link";
import { NavLinkPendingHint } from "../pending-ui";

/**
 * Second-level nav within the Businesses section -- Directory (the
 * card-based, status-classified registry) vs. Permit History (the dense
 * historical transaction table). These answer different questions ("what
 * does this business need right now" vs. "show me every permit ever
 * issued") so they stay separate views rather than one page trying to be
 * both -- see CLAUDE.md's write-up of this decision.
 */
export function BusinessesSubNav({ active }: { active: "directory" | "history" }) {
  return (
    <div className="mb-6 flex gap-1.5 border-b border-border">
      <Link
        href="/dashboard/businesses"
        className={`-mb-px border-b-2 px-3 pb-2.5 font-display text-[13.5px] font-bold transition-colors ${
          active === "directory" ? "border-brand-navy text-brand-navy" : "border-transparent text-ink-faint hover:text-ink-soft"
        }`}
      >
        Directory
        <NavLinkPendingHint />
      </Link>
      <Link
        href="/dashboard/businesses/history"
        className={`-mb-px border-b-2 px-3 pb-2.5 font-display text-[13.5px] font-bold transition-colors ${
          active === "history" ? "border-brand-navy text-brand-navy" : "border-transparent text-ink-faint hover:text-ink-soft"
        }`}
      >
        Permit History
        <NavLinkPendingHint />
      </Link>
    </div>
  );
}
