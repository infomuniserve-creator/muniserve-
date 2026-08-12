import { getPilotLguId } from "@/lib/lgu";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

/**
 * Drives the application form's "LBT category" dropdown from the actual
 * seeded fee_rules rather than a hardcoded list (rule #1) -- onboarding
 * LGU #2 with different LBT schedules changes this dropdown with zero
 * code changes, since it's the same query against different rows.
 */
export async function GET() {
  const supabase = createServiceClient();
  const lguId = await getPilotLguId();

  const { data, error } = await supabase
    .from("fee_rules")
    .select("applies_to, name")
    .eq("lgu_id", lguId)
    .eq("is_active", true)
    .like("name", "LBT Schedule%")
    .order("sort_order");

  if (error) {
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  return NextResponse.json({
    categories: (data ?? []).map((r) => ({ value: r.applies_to, label: r.name })),
  });
}
