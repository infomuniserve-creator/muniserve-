import { getCurrentStaff } from "@/lib/staff";
import { redirect } from "next/navigation";
import { BusinessesSection, GettingStartedSection, PipelineSection } from "./kb-content-workflow";
import { SettingsSection } from "./kb-content-settings";
import { FaqSection, NotificationsSection, ReportingSection } from "./kb-content-reference";
import { KbSidebarNav, type KbNavGroup } from "./kb-sidebar-nav";

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
/**
 * `keywords` (2026-08-21, powers KbSidebarNav's own live search) is a
 * curated blob of terms that actually appear inside each section but
 * aren't necessarily in its own short title -- e.g. searching "FSIF" or
 * "sign out" should still find the right section even though neither
 * word is the section's own name.
 */
const NAV_GROUPS: KbNavGroup[] = [
  {
    title: "Start here",
    links: [
      {
        href: "#getting-started",
        label: "Getting Started",
        keywords: "sign in google account roles bplo department treasury mayor top bar dark mode theme sign out profile menu knowledge base initials",
      },
    ],
  },
  {
    title: "Applications",
    links: [
      {
        href: "#pipeline",
        label: "The Review Pipeline",
        keywords:
          "initial review departments review assessment payment printing mayor's signature release approve approved with condition reject rejected request more info notes required lbt category archive archived returned to applicant engineering building permit fee bi-annually quarterly mode of payment stages",
      },
    ],
  },
  {
    title: "Businesses",
    links: [
      {
        href: "#businesses",
        label: "Businesses",
        keywords: "business registry walk-in walk in claim unclaim legacy permit history lbt category active needs renewal inactive in progress owner phone",
      },
    ],
  },
  {
    title: "Settings",
    links: [
      {
        href: "#settings",
        label: "Settings (BPLO)",
        keywords:
          "staff access data import fee rates barangays barangay clearance assessment rules automated assessment cedula documents alerts lgu logo permit number format order of payment accepted payment methods gcash sms usage sms notifications sender name public application form embed",
      },
    ],
  },
  {
    title: "Reporting",
    links: [
      {
        href: "#reporting",
        label: "Audit Trail & Stats",
        keywords: "audit trail stats reports performance bottleneck revenue csv export",
      },
    ],
  },
  {
    title: "Notifications",
    links: [
      {
        href: "#notifications",
        label: "What Applicants Are Told",
        keywords:
          "sms email notification otp fsif fire safety inspection fee bfp assessment finalized payment received permit signed permit released installment reminder upload proof",
      },
    ],
  },
  {
    title: "Help",
    links: [
      {
        href: "#faq",
        label: "FAQ & Troubleshooting",
        keywords: "faq troubleshooting can't approve blank note no text no email act on behalf",
      },
    ],
  },
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
        <div className="rounded-3xl border border-border bg-surface p-4 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
          <KbSidebarNav groups={NAV_GROUPS} />
        </div>
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
