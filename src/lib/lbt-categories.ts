import { createServiceClient } from "@/lib/supabase/service";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LbtCategoryOption = { value: string; label: string };

/**
 * The set of LBT schedule categories seeded as fee_rules, rather than a
 * hardcoded list (rule #1) -- onboarding LGU #2 with different LBT
 * schedules changes this with zero code changes, since it's the same
 * query against different rows.
 *
 * Previously lived inline in the applicant-facing lbt-categories API route.
 * Extracted so BPLO's manual-override control (bplo/actions.ts) can reuse
 * the exact same query instead of duplicating it -- applicants no longer
 * self-select an LBT category (the real intake form never asked for one;
 * see reference/official-application-form/README.md), but BPLO still needs
 * this list to fill it in themselves until the fee engine (build order
 * step 7) can derive it from nature_of_business automatically.
 *
 * Filters on `fee_category = 'lbt'` (migration 0026's discriminator),
 * not a `name LIKE 'LBT Schedule%'` guess -- switched 2026-08-15 alongside
 * the CSV import feature (src/lib/fee-rule-import.ts), since an imported
 * schedule has no reason to keep San Miguel's exact naming convention.
 * Every row this used to match already has fee_category = 'lbt' too (that's
 * literally how migration 0026 backfilled it), so this is a strict
 * widening, not a behavior change for any LGU onboarded before this.
 */
export async function getLbtCategoryOptions(lguId: string): Promise<LbtCategoryOption[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("fee_rules")
    .select("applies_to, name")
    .eq("lgu_id", lguId)
    .eq("is_active", true)
    .eq("fee_category", "lbt")
    .order("sort_order");

  if (error) throw error;
  return (data ?? []).map((r) => ({ value: r.applies_to as string, label: r.name as string }));
}

/**
 * The single place that writes `businesses.lbt_category` -- both
 * `bplo/actions.ts`'s initial-review-card control and
 * `businesses/actions.ts`'s Business Registry control call this rather
 * than each running its own `.update()`, so there's exactly one thing to
 * check if this write ever needs to change (e.g. logging it to
 * audit_log). Takes the caller's own RLS-scoped session -- migration
 * 0009's "bplo can update businesses at their own lgu" policy already
 * covers both call sites.
 */
export async function setBusinessLbtCategory(
  supabase: SupabaseClient,
  businessId: string,
  lbtCategory: string | null
): Promise<void> {
  const { error } = await supabase.from("businesses").update({ lbt_category: lbtCategory }).eq("id", businessId);
  if (error) throw error;
}

/**
 * The hard gate the project owner asked for after testing (2026-08-14):
 * an application should never be able to enter department review at all
 * without an LBT category on file, rather than silently sailing through
 * three review stages and only failing once it reaches Assessment with
 * no way back. Called from both places that can put an application into
 * `pending_dept_review` -- `submitInitialReview` (the normal applicant
 * flow) and `startWalkInApplication` (which used to skip the
 * initial-review card, and its LBT-category control, entirely). Throws
 * rather than returning a boolean since both call sites already throw on
 * their own validation failures (e.g. `finalizeAssessment`'s identical
 * `if (!result.ok) throw new Error(result.blockedReason)` pattern) --
 * this is a defense-in-depth backstop, not the primary guard, since both
 * call sites also disable their own "Approve"/"Start application" button
 * client-side when the category is missing.
 */
export async function requireLbtCategorySet(supabase: SupabaseClient, businessId: string): Promise<void> {
  const { data, error } = await supabase.from("businesses").select("lbt_category").eq("id", businessId).single();
  if (error) throw error;
  if (!data?.lbt_category) {
    throw new Error(
      "This business has no LBT category set yet. Set it in the Business Registry before this application can move to department review."
    );
  }
}
