"use client";

import { useState } from "react";
import { StatGrid } from "../ui";

export type BploTabKey =
  | "initial"
  | "dept_review"
  | "assessment"
  | "payment"
  | "printing"
  | "signature"
  | "release"
  | "released";

export type BploTabDef = {
  key: BploTabKey;
  statCard: React.ReactNode; // a pre-built <StatCard .../> element, rendered as-is
  content: React.ReactNode; // that stage's section, pre-rendered server-side
};

/**
 * BPLO's own request: the 8 pipeline stat cards double as tabs -- only the
 * clicked stage's queue shows below, instead of every stage stacked on the
 * page at once. Defaults to "Initial review" on load. Deliberately scoped
 * to just these 8 stages (the ones with a real stat card) -- "Returned to
 * applicant" and "Archived" are side states, not pipeline stages, and stay
 * as their own always-visible CollapsibleSections below this, unchanged.
 *
 * A client component wrapping pre-rendered Server Component output, not a
 * re-implementation -- `content` for each tab is built server-side in
 * page.tsx exactly as before (including the async InitialReviewCard/
 * AssessmentCard components), then handed here as already-resolved React
 * nodes. This component only ever decides which one to show, matching the
 * same "Server Components as children of a Client Component" shape this
 * project's other tabbed view (audit-trail-table.tsx) already established.
 */
export function BploDashboardTabs({ tabs, defaultTab }: { tabs: BploTabDef[]; defaultTab: BploTabKey }) {
  const [activeTab, setActiveTab] = useState<BploTabKey>(defaultTab);
  const active = tabs.find((t) => t.key === activeTab) ?? tabs[0];

  return (
    <>
      {/* role="tablist"/"tab"/"tabpanel" -- these stat cards are a real tab
          switcher, but weren't marked up as one (2026-08-20 audit finding):
          a screen reader announced them as a plain list of buttons rather
          than a tab interface, and expected arrow-key tab navigation didn't
          work. */}
      <div role="tablist" aria-label="Application pipeline stage">
        <StatGrid>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`bplo-tab-${t.key}`}
              aria-selected={t.key === activeTab}
              aria-controls={`bplo-tabpanel-${t.key}`}
              onClick={() => setActiveTab(t.key)}
              className={`rounded-3xl border-0 bg-transparent p-0 text-left transition hover:opacity-90 ${
                t.key === activeTab ? "ring-2 ring-brand-teal ring-offset-2 ring-offset-bg" : ""
              }`}
            >
              {t.statCard}
            </button>
          ))}
        </StatGrid>
      </div>

      <div className="mb-9" role="tabpanel" id={active ? `bplo-tabpanel-${active.key}` : undefined} aria-labelledby={active ? `bplo-tab-${active.key}` : undefined}>
        {active?.content}
      </div>
    </>
  );
}
