import { getCurrentStaff } from "@/lib/staff";
import { redirect } from "next/navigation";
import { BusinessesSection, GettingStartedSection, PipelineSection } from "./kb-content-workflow";
import { SettingsSection } from "./kb-content-settings";
import { FaqSection, NotificationsSection, ReportingSection } from "./kb-content-reference";

/**
 * Staff Knowledge Base (2026-08-21) -- linked from the top bar's own
 * "Knowledge Base" button (persistent-top-bar.tsx), which took over the
 * spot the plain "Sign out" pill used to occupy once sign-out moved into
 * ProfileMenu. Open to every staff role, not just BPLO/Mayor (unlike
 * Audit Trail/Stats) -- this teaches every role their own part of the
 * system, plain-language throughout, designed and approved as a real
 * Artifact mockup before any of this content was written.
 *
 * One long page with anchor-link navigation, not separate routes per
 * section -- no client JS needed for the nav itself (a plain `<a
 * href="#id">` + CSS `scroll-mt` on each heading is enough), matching
 * this app's own preference for plain HTML mechanisms over client state
 * wherever one will do (CollapsibleSection, the Audit Trail's own
 * disclosure widgets, ...).
 *
 * Every "screenshot" in here is a real, hand-built recreation using this
 * app's own actual design tokens, not a raster image -- see kb-ui.tsx's
 * own doc comment for why (no reliable way to screenshot a live staff
 * session in this build environment, and a recreation never goes stale).
 */
const NAV_GROUPS: { title: string; links: { href: string; label: string }[] }[] = [
  { title: "Start here", links: [{ href: "#getting-started", label: "Getting Started" }] },
  { title: "Applications", links: [{ href: "#pipeline", label: "The Review Pipeline" }] },
  { title: "Businesses", links: [{ href: "#businesses", label: "Businesses" }] },
  { title: "Settings", links: [{ href: "#settings", label: "Settings (BPLO)" }] },
  { title: "Reporting", links: [{ href: "#reporting", label: "Audit Trail & Stats" }] },
  { title: "Notifications", links: [{ href: "#notifications", label: "What Applicants Are Told" }] },
  { title: "Help", links: [{ href: "#faq", label: "FAQ & Troubleshooting" }] },
];

export default async function KnowledgeBasePage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
      <aside className="shrink-0 lg:sticky lg:top-6 lg:w-56">
        <div className="mb-3">
          <p className="font-display text-[12px] font-extrabold uppercase tracking-wide text-brand-teal">Staff Knowledge Base</p>
          <h1 className="font-display text-[24px] font-bold text-ink">How to use MuniServe</h1>
        </div>
        <nav className="flex flex-col gap-3.5 rounded-3xl border border-border bg-surface p-4 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="mb-1 px-2 text-[10.5px] font-extrabold uppercase tracking-wide text-ink-faint">{group.title}</p>
              {group.links.map((l) => (
                <a key={l.href} href={l.href} className="block rounded-xl px-2 py-1.5 text-[12.5px] font-bold text-ink-soft transition-colors hover:bg-info-bg hover:text-info-ink">
                  {l.label}
                </a>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 max-w-[760px] flex-1">
        <p className="mb-8 max-w-[60ch] text-[14px] leading-relaxed text-ink-soft">
          Plain-language guides for every part of the system — what each section does, who sees what, and exactly what your applicants receive and when.
        </p>
        <GettingStartedSection />
        <PipelineSection />
        <BusinessesSection />
        <SettingsSection />
        <ReportingSection />
        <NotificationsSection />
        <FaqSection />
      </div>
    </div>
  );
}
