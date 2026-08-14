import { fetchAllRows } from "@/lib/db-pagination";
import type { SupabaseClient } from "@supabase/supabase-js";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const diff = (new Date(b).getTime() - new Date(a).getTime()) / MS_PER_DAY;
  return diff >= 0 ? diff : null; // negative would mean bad/out-of-order data -- never show a misleading negative duration
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export type PerformanceStats = {
  totalApplications: number;
  releasedCount: number;
  avgDaysSubmittedToReleased: number | null;
  medianDaysSubmittedToReleased: number | null;
  byType: Record<"new" | "renewal", { count: number; avgDays: number | null }>;
  stageAverages: { stage: string; avgDays: number | null; sampleSize: number }[];
  departmentTurnaround: { department: string; avgDays: number | null; medianDays: number | null; sampleSize: number; pendingCount: number }[];
  stuckApplications: { id: string; referenceNumber: string; businessName: string; status: string; daysStuck: number }[];
};

const STATUS_LABEL: Record<string, string> = {
  pending_bplo_initial: "Initial review",
  pending_dept_review: "Departments review",
  pending_bplo_assessment: "Assessment review",
  pending_payment: "Treasurer approval",
  pending_printing: "For printing",
  pending_mayor: "Mayor's signature",
  pending_release: "For release",
};

/**
 * Computes processing-speed and bottleneck stats for a date range
 * (CLAUDE.md 7o follow-up) -- the project owner asked directly: "where
 * mostly the department that takes time approving, or where the
 * bottleneck is happening." Every duration here is computed in JS from
 * plain fetched rows (matching this app's established pattern --
 * business-status.ts, fee-engine.ts -- rather than hand-rolled SQL
 * aggregation), so the exact same numbers a person could recompute by
 * hand from the Audit Trail are what get shown here.
 *
 * Some stage durations are genuine, others are best-effort
 * approximations given what's actually captured on `applications` --
 * documented per stage below rather than presented as more precise than
 * they are.
 */
export async function computePerformanceStats(
  supabase: SupabaseClient,
  lguId: string,
  range: { from: string; to: string }
): Promise<PerformanceStats> {
  const fromIso = `${range.from}T00:00:00.000Z`;
  const toIso = `${range.to}T23:59:59.999Z`;

  const applications = await fetchAllRows<{
    id: string;
    reference_number: string | null;
    application_type: string;
    status: string;
    submitted_at: string;
    initial_review_at: string | null;
    assessment_finalized_at: string | null;
    printed_at: string | null;
    released_at: string | null;
    business: { business_name: string } | { business_name: string }[] | null;
  }>((offset, limit) =>
    supabase
      .from("applications")
      .select(
        "id, reference_number, application_type, status, submitted_at, initial_review_at, assessment_finalized_at, printed_at, released_at, business:businesses(business_name)",
        { count: "exact" }
      )
      .eq("lgu_id", lguId)
      .gte("submitted_at", fromIso)
      .lte("submitted_at", toIso)
      .order("submitted_at", { ascending: false })
      .range(offset, offset + limit - 1)
  );

  const appIds = applications.map((a) => a.id);
  if (appIds.length === 0) {
    return {
      totalApplications: 0,
      releasedCount: 0,
      avgDaysSubmittedToReleased: null,
      medianDaysSubmittedToReleased: null,
      byType: { new: { count: 0, avgDays: null }, renewal: { count: 0, avgDays: null } },
      stageAverages: [],
      departmentTurnaround: [],
      stuckApplications: [],
    };
  }

  const [rounds, payments, permits] = await Promise.all([
    fetchAllRows<{ id: string; application_id: string; round_number: number; opened_at: string }>((offset, limit) =>
      supabase
        .from("review_rounds")
        .select("id, application_id, round_number, opened_at", { count: "exact" })
        .in("application_id", appIds)
        .range(offset, offset + limit - 1)
    ),
    fetchAllRows<{ application_id: string; received_at: string }>((offset, limit) =>
      supabase.from("payments").select("application_id, received_at", { count: "exact" }).in("application_id", appIds).range(offset, offset + limit - 1)
    ),
    fetchAllRows<{ application_id: string; issued_at: string | null }>((offset, limit) =>
      supabase.from("permits").select("application_id, issued_at", { count: "exact" }).in("application_id", appIds).range(offset, offset + limit - 1)
    ),
  ]);

  const roundIds = rounds.map((r) => r.id);
  const departmentReviews =
    roundIds.length === 0
      ? []
      : await fetchAllRows<{ review_round_id: string; department: string; decision: string; reviewed_at: string | null }>((offset, limit) =>
          supabase
            .from("department_reviews")
            .select("review_round_id, department, decision, reviewed_at", { count: "exact" })
            .in("review_round_id", roundIds)
            .range(offset, offset + limit - 1)
        );

  const roundById = new Map(rounds.map((r) => [r.id, r]));
  const roundsByApp = new Map<string, typeof rounds>();
  for (const r of rounds) {
    const list = roundsByApp.get(r.application_id) ?? [];
    list.push(r);
    roundsByApp.set(r.application_id, list);
  }
  const firstPaymentByApp = new Map<string, string>();
  for (const p of payments) {
    const existing = firstPaymentByApp.get(p.application_id);
    if (!existing || p.received_at < existing) firstPaymentByApp.set(p.application_id, p.received_at);
  }
  const permitByApp = new Map(permits.filter((p) => p.issued_at).map((p) => [p.application_id, p.issued_at as string]));

  // Latest non-pending decision per application, across all its rounds --
  // "when did departments finish" for stage-duration purposes.
  const deptClearedAtByApp = new Map<string, string>();
  for (const dr of departmentReviews) {
    if (!dr.reviewed_at) continue;
    const round = roundById.get(dr.review_round_id);
    if (!round) continue;
    const existing = deptClearedAtByApp.get(round.application_id);
    if (!existing || dr.reviewed_at > existing) deptClearedAtByApp.set(round.application_id, dr.reviewed_at);
  }

  // ---- Overall + by-type ----
  const released = applications.filter((a) => a.status === "released" && a.released_at);
  const releaseDurations = released.map((a) => daysBetween(a.submitted_at, a.released_at)).filter((d): d is number => d != null);

  function byTypeStats(type: string) {
    const rel = released.filter((a) => a.application_type === type);
    const durations = rel.map((a) => daysBetween(a.submitted_at, a.released_at)).filter((d): d is number => d != null);
    return { count: applications.filter((a) => a.application_type === type).length, avgDays: average(durations) };
  }

  // ---- Stage averages (CLAUDE.md 7o: some are exact, some are
  // best-effort given what's actually captured) ----
  const initialReviewDurations = applications.map((a) => daysBetween(a.submitted_at, a.initial_review_at)).filter((d): d is number => d != null);

  const deptRoundDurations = applications
    .map((a) => {
      const firstRound = (roundsByApp.get(a.id) ?? []).find((r) => r.round_number === 1);
      const clearedAt = deptClearedAtByApp.get(a.id);
      return firstRound ? daysBetween(firstRound.opened_at, clearedAt ?? null) : null;
    })
    .filter((d): d is number => d != null);

  const assessmentDurations = applications
    .map((a) => daysBetween(deptClearedAtByApp.get(a.id) ?? null, a.assessment_finalized_at))
    .filter((d): d is number => d != null);

  const paymentDurations = applications
    .map((a) => daysBetween(a.assessment_finalized_at, firstPaymentByApp.get(a.id) ?? null))
    .filter((d): d is number => d != null);

  const printingDurations = applications
    .map((a) => daysBetween(firstPaymentByApp.get(a.id) ?? null, a.printed_at))
    .filter((d): d is number => d != null);

  const mayorDurations = applications
    .map((a) => daysBetween(a.printed_at, permitByApp.get(a.id) ?? null))
    .filter((d): d is number => d != null);

  const releaseStepDurations = applications
    .map((a) => daysBetween(permitByApp.get(a.id) ?? null, a.released_at))
    .filter((d): d is number => d != null);

  const stageAverages = [
    { stage: "Initial review (BPLO)", avgDays: average(initialReviewDurations), sampleSize: initialReviewDurations.length },
    { stage: "Departments review", avgDays: average(deptRoundDurations), sampleSize: deptRoundDurations.length },
    { stage: "Assessment (BPLO)", avgDays: average(assessmentDurations), sampleSize: assessmentDurations.length },
    { stage: "Payment (applicant)", avgDays: average(paymentDurations), sampleSize: paymentDurations.length },
    { stage: "Printing (BPLO)", avgDays: average(printingDurations), sampleSize: printingDurations.length },
    { stage: "Mayor's signature", avgDays: average(mayorDurations), sampleSize: mayorDurations.length },
    { stage: "Release (BPLO)", avgDays: average(releaseStepDurations), sampleSize: releaseStepDurations.length },
  ];

  // ---- Department turnaround (the actual "who's the bottleneck" answer) ----
  const byDepartment = new Map<string, { durations: number[]; pendingCount: number }>();
  for (const dr of departmentReviews) {
    const entry = byDepartment.get(dr.department) ?? { durations: [], pendingCount: 0 };
    if (dr.decision === "pending") {
      entry.pendingCount += 1;
    } else if (dr.reviewed_at) {
      const round = roundById.get(dr.review_round_id);
      if (round) {
        const d = daysBetween(round.opened_at, dr.reviewed_at);
        if (d != null) entry.durations.push(d);
      }
    }
    byDepartment.set(dr.department, entry);
  }
  const departmentTurnaround = [...byDepartment.entries()]
    .map(([department, { durations, pendingCount }]) => ({
      department,
      avgDays: average(durations),
      medianDays: median(durations),
      sampleSize: durations.length,
      pendingCount,
    }))
    .sort((a, b) => (b.avgDays ?? -1) - (a.avgDays ?? -1));

  // ---- Currently stuck (live, not historical) -- "days stuck" uses the
  // best available "entered this stage" timestamp, falling back to
  // submitted_at when a more specific one isn't captured (see module
  // comment).
  const OPEN_STATUSES = new Set(Object.keys(STATUS_LABEL));
  const now = Date.now();
  const stuckApplications = applications
    .filter((a) => OPEN_STATUSES.has(a.status))
    .map((a) => {
      const firstRound = (roundsByApp.get(a.id) ?? []).find((r) => r.round_number === 1);
      const enteredAt: string =
        a.status === "pending_dept_review"
          ? (firstRound?.opened_at ?? a.submitted_at)
          : a.status === "pending_payment"
            ? (a.assessment_finalized_at ?? a.submitted_at)
            : a.status === "pending_printing"
              ? (firstPaymentByApp.get(a.id) ?? a.submitted_at)
              : a.status === "pending_mayor"
                ? (a.printed_at ?? a.submitted_at)
                : a.status === "pending_release"
                  ? (permitByApp.get(a.id) ?? a.submitted_at)
                  : a.submitted_at;
      const business = Array.isArray(a.business) ? a.business[0] : a.business;
      return {
        id: a.id,
        referenceNumber: a.reference_number ?? a.id,
        businessName: business?.business_name ?? "(business record missing)",
        status: STATUS_LABEL[a.status] ?? a.status,
        daysStuck: (now - new Date(enteredAt).getTime()) / MS_PER_DAY,
      };
    })
    .sort((a, b) => b.daysStuck - a.daysStuck);

  return {
    totalApplications: applications.length,
    releasedCount: released.length,
    avgDaysSubmittedToReleased: average(releaseDurations),
    medianDaysSubmittedToReleased: median(releaseDurations),
    byType: { new: byTypeStats("new"), renewal: byTypeStats("renewal") },
    stageAverages,
    departmentTurnaround,
    stuckApplications,
  };
}
