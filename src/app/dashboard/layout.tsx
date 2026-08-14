import { getCurrentStaff } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { createClient } from "@/lib/supabase/server";
import { exitViewAs } from "../admin/actions";
import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";

const ROLE_LABEL: Record<string, string> = {
  bplo: "BPLO",
  treasury: "Treasury",
  mayor: "Mayor's Office",
  department: "Department",
};

/**
 * Shared shell for every dashboard route (BPLO, department, treasury,
 * mayor, Business Registry). Three jobs:
 *
 * 1. Outer padding -- the redesigned pages had no breathing room from the
 *    viewport edge (the top bar sat flush against the browser's own UI).
 *    One wrapper here instead of every page repeating its own margin.
 * 2. Reads the `theme` cookie (set by theme-toggle.tsx) and applies it as
 *    `data-theme` on #dashboard-shell -- scoped to the dashboard, not
 *    `<html>`, so this layout can read cookies (opting this subtree out
 *    of static rendering) without also opting the public marketing/apply/
 *    login pages out of it. See globals.css for the token overrides this
 *    attribute triggers, and theme-toggle.tsx for why the id has to match.
 * 3. A banner when the signed-in "staff" is actually a platform admin's
 *    "view as" proxy row (CLAUDE.md 7o follow-up) -- every page under
 *    /dashboard renders through this layout, so it's the one place that
 *    guarantees a platform admin never mistakes a client's real dashboard
 *    for their own, no matter which of the four role dashboards they're
 *    currently viewing.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const theme = cookieStore.get("theme")?.value;
  const dataTheme = theme === "dark" || theme === "light" ? theme : undefined;

  const staff = await getCurrentStaff();
  let adminBanner: ReactNode = null;
  if (staff?.is_admin_proxy) {
    const supabase = await createClient();
    const lgu = await getLguDisplay(supabase, staff.lgu_id);
    const roleLabel = staff.role === "department" ? `${staff.department} Department` : ROLE_LABEL[staff.role];
    adminBanner = (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-warn-bg px-4 py-2.5 text-[12.5px] font-bold text-warn-ink">
        <span>
          🛡️ Platform Admin — viewing {lgu.name}
          {lgu.province ? `, ${lgu.province}` : ""} as {roleLabel}
        </span>
        <div className="flex items-center gap-3">
          <form action={exitViewAs}>
            <button type="submit" className="underline underline-offset-2">
              Exit view-as
            </button>
          </form>
          <Link href="/admin" className="underline underline-offset-2">
            Back to admin
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div id="dashboard-shell" data-theme={dataTheme} className="min-h-screen bg-bg px-4 py-6 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-7xl">
        {adminBanner}
        {children}
      </div>
    </div>
  );
}
