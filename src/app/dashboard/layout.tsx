import { cookies } from "next/headers";
import type { ReactNode } from "react";

/**
 * Shared shell for every dashboard route (BPLO, department, treasury,
 * mayor, Business Registry). Two jobs:
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
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const theme = cookieStore.get("theme")?.value;
  const dataTheme = theme === "dark" || theme === "light" ? theme : undefined;

  return (
    <div id="dashboard-shell" data-theme={dataTheme} className="min-h-screen bg-bg px-4 py-6 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl">{children}</div>
    </div>
  );
}
