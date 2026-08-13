/**
 * Classifies a business's real-world status for the Business Registry --
 * "is this permit current, lapsed, unclaimed, closed, or mid-review right
 * now." None of this is a stored column; it's derived from three real
 * signals (businesses.is_legacy_unclaimed/is_active, whether an
 * application is currently in flight, and the latest permits.valid_until
 * for that business), because that's genuinely what those signals mean --
 * there's no per-business "next renewal date" field to just read.
 *
 * `permits.valid_until` is set once, at sign-and-release, to December 31
 * of the application's year (mayor/actions.ts, citing CLAUDE.md section
 * 6 / RA 7160 sec. 4.04 -- permits expire end of calendar year, not on a
 * rolling anniversary). That's the authoritative "is this permit current"
 * check; application_year alone would double-count a business renewed
 * early in the year for the *next* year's permit.
 *
 * `in_progress` isn't one of the mockup's four buckets -- added because a
 * business with a live application would otherwise be silently
 * misclassified as "needs renewal" while BPLO is actively working it.
 * It's checked BEFORE the legacy/inactive flags for the same reason: a
 * legacy-unclaimed business that BPLO just filed a walk-in application
 * for (Business Registry, actions.ts) stays is_legacy_unclaimed=true
 * until a phone number links it to a real owner, but it's clearly no
 * longer just sitting unclaimed -- something's actively happening.
 */

export type BusinessStatus = "active" | "needs_renewal" | "legacy" | "inactive" | "in_progress";

const TERMINAL_STATUSES = new Set(["released", "rejected"]);

export function classifyBusinessStatus(params: {
  isLegacyUnclaimed: boolean;
  isActive: boolean;
  applicationStatuses: string[]; // every application's status for this business
  latestPermitValidUntil: string | null; // ISO date, or null if never issued one
  today: Date;
}): BusinessStatus {
  const { isLegacyUnclaimed, isActive, applicationStatuses, latestPermitValidUntil, today } = params;

  if (applicationStatuses.some((s) => !TERMINAL_STATUSES.has(s))) return "in_progress";
  if (isLegacyUnclaimed) return "legacy";
  if (!isActive) return "inactive";
  if (latestPermitValidUntil) {
    return new Date(latestPermitValidUntil) >= today ? "active" : "needs_renewal";
  }
  // Active, not legacy, no in-flight application, and no permit ever
  // issued -- shouldn't happen in steady state (submitting always creates
  // an application), but if it does, treat it as needing attention rather
  // than silently calling it "active".
  return "needs_renewal";
}

export const BUSINESS_STATUS_LABEL: Record<BusinessStatus, string> = {
  active: "Active permit",
  needs_renewal: "Needs renewal",
  legacy: "Legacy — not claimed",
  inactive: "Inactive",
  in_progress: "In progress",
};

/** Matches the semantic tone keys used across ui.tsx's Pill/StatCard components. */
export const BUSINESS_STATUS_TONE: Record<BusinessStatus, "good" | "warn" | "info" | "neutral"> = {
  active: "good",
  needs_renewal: "warn",
  legacy: "info",
  inactive: "neutral",
  in_progress: "info",
};
