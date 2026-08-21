"use client";

import { usePathname } from "next/navigation";
import { DashboardTopBar } from "./ui";

/**
 * Hoists DashboardTopBar out of every individual page.tsx and into
 * dashboard/layout.tsx (2026-08-16, CLAUDE.md 7bb follow-up) -- the real
 * fix for "I click a tab and nothing visibly happens." Every page used
 * to render its own copy of the top bar as part of its own returned
 * JSX, which meant the top bar (and the NavLinkPendingHint dot added in
 * the previous pass) was inside the same tree loading.tsx's Suspense
 * boundary replaces during a slow navigation -- the whole nav bar,
 * including the tab the user just clicked, visibly vanished and got
 * swapped for a generic gray skeleton with no nav pills in it at all.
 * That's what the project owner's screenshot actually showed: the
 * skeleton *was* working, there was just nothing persistent left on
 * screen to anchor "yes, this is responding to my click."
 *
 * Layout.tsx renders this ABOVE `{children}`, outside the route
 * segment's own Suspense boundary, so it now survives every
 * navigation untouched -- the pending dot stays visible, and the page
 * genuinely feels like a continuation instead of a jolt, which was
 * loading.tsx's own original stated goal but never actually achieved
 * while the top bar lived inside the thing being replaced.
 *
 * `active` is the one prop that varies per PAGE rather than per role,
 * so it can't be computed once in the server layout the way
 * officeLabel/applicationsHref/etc. already are -- derived here from
 * the live pathname instead (usePathname, the reason this has to be a
 * client component).
 */
function deriveActiveTab(pathname: string): "applications" | "businesses" | "settings" | "audit" | "stats" {
  if (pathname.startsWith("/dashboard/businesses")) return "businesses";
  if (pathname.startsWith("/dashboard/settings")) return "settings";
  if (pathname.startsWith("/dashboard/audit")) return "audit";
  if (pathname.startsWith("/dashboard/stats")) return "stats";
  return "applications";
}

export function PersistentTopBar({
  officeLabel,
  officeSub,
  initials,
  fullName,
  applicationsHref,
  settingsHref,
  auditHref,
  statsHref,
}: {
  officeLabel: string;
  officeSub: string;
  initials: string;
  fullName: string;
  applicationsHref: string;
  settingsHref?: string;
  auditHref?: string;
  statsHref?: string;
}) {
  const pathname = usePathname();
  return (
    <DashboardTopBar
      officeLabel={officeLabel}
      officeSub={officeSub}
      initials={initials}
      fullName={fullName}
      active={deriveActiveTab(pathname)}
      applicationsHref={applicationsHref}
      settingsHref={settingsHref}
      auditHref={auditHref}
      statsHref={statsHref}
      rightSlot={
        // Took over the spot the plain "Sign out" pill used to occupy
        // (2026-08-21, project owner's own request) -- sign-out itself
        // moved into ProfileMenu, under the avatar. A real new tab, not
        // this one, since staff likely still want the dashboard open
        // behind it while reading.
        <a
          href="/dashboard/knowledge-base"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-border px-3.5 py-1.5 text-[12.5px] font-bold text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
        >
          Knowledge Base
        </a>
      }
    />
  );
}
