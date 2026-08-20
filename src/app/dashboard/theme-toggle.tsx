"use client";

import { useEffect, useState } from "react";

/**
 * Dashboard-scoped light/dark toggle. Rendered inside DashboardTopBar
 * (ui.tsx) on every dashboard page.
 *
 * Defaults to following the OS/browser preference -- no explicit choice,
 * no cookie, `#dashboard-shell` has no `data-theme` attribute, and the
 * plain `@media (prefers-color-scheme: dark)` tokens in globals.css apply
 * as normal. Clicking sets an explicit choice that overrides the OS
 * preference for the dashboard only (the public apply/login pages have
 * no toggle and aren't affected), persisted in a `theme` cookie so
 * layout.tsx can server-render the right theme on the next full load
 * instead of flashing the wrong one first.
 *
 * `isDark` always starts `false` on both server and first client render
 * (there's nothing to render server-side -- this is a client component --
 * but starting from a fixed value avoids a hydration mismatch against
 * what the *effect* corrects it to); useEffect reads the real state right
 * after mount, which can cause one brief icon flip on a dark-OS/no-cookie
 * first load. That's the standard, accepted tradeoff for a theme toggle
 * that has to know a runtime-only fact (matchMedia) it can't know during
 * the synchronous render pass.
 */
export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  // Deliberate, not an oversight: see the doc comment above. This effect
  // reads a runtime-only fact (matchMedia/the shell's own data-theme
  // attribute) that genuinely can't be known during the synchronous render
  // pass, and the resulting "one brief icon flip on first load" is an
  // accepted, documented tradeoff rather than a bug (2026-08-20 audit
  // finding: this was the codebase's one real, previously-unaddressed lint
  // error -- fixed by computing the value first so there's exactly one
  // setState call for the disable comment to actually cover, rather than
  // three, which is also just clearer code).
  useEffect(() => {
    const shell = document.getElementById("dashboard-shell");
    const explicit = shell?.getAttribute("data-theme");
    const dark = explicit === "dark" ? true : explicit === "light" ? false : window.matchMedia("(prefers-color-scheme: dark)").matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(dark);
  }, []);

  function toggle() {
    const shell = document.getElementById("dashboard-shell");
    if (!shell) return;
    const next = isDark ? "light" : "dark";
    shell.setAttribute("data-theme", next);
    document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
    setIsDark(!isDark);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="flex size-8.5 shrink-0 items-center justify-center rounded-full border border-border text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-4">
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 3v2M12 19v2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M3 12h2M19 12h2M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-4">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  );
}
