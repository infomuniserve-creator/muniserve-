import { createServiceClient } from "@/lib/supabase/service";

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
 */
export async function getLbtCategoryOptions(lguId: string): Promise<LbtCategoryOption[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("fee_rules")
    .select("applies_to, name")
    .eq("lgu_id", lguId)
    .eq("is_active", true)
    .like("name", "LBT Schedule%")
    .order("sort_order");

  if (error) throw error;
  return (data ?? []).map((r) => ({ value: r.applies_to as string, label: r.name as string }));
}
