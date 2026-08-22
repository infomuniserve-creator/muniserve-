import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The delivery fee for one specific barangay (2026-08-22) -- same
 * "specific override, else uniform 'all' fallback" lookup as
 * getBarangayClearanceRate's own logic (fee-engine.ts), reused here as
 * its own small helper since this is deliberately NOT part of the
 * fee-computation graph (a delivery fee is a private courier
 * arrangement, not an official assessed fee -- see migration 0065's
 * own comment for why it still lives in fee_rules anyway).
 *
 * Returns null when nothing is configured for this barangay at all
 * (no specific row, no uniform fallback) -- callers show "contact BPLO"
 * rather than a guessed amount in that case.
 */
export async function getDeliveryFeeForBarangay(supabase: SupabaseClient, lguId: string, barangay: string | null): Promise<number | null> {
  const { data } = await supabase
    .from("fee_rules")
    .select("applies_to, flat_amount")
    .eq("lgu_id", lguId)
    .eq("fee_category", "delivery_fee")
    .eq("is_active", true)
    .in("applies_to", [barangay ?? "__none__", "all"]);

  const rows = data ?? [];
  const specific = barangay ? rows.find((r) => r.applies_to === barangay) : undefined;
  if (specific) return specific.flat_amount;
  const uniform = rows.find((r) => r.applies_to === "all");
  return uniform?.flat_amount ?? null;
}
