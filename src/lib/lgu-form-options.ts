import { NATURE_OF_BUSINESS_OPTIONS } from "@/lib/san-miguel-form-options";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LguFormOptions = {
  barangayOptions: string[];
  natureOfBusinessOptions: string[];
};

/**
 * Per-LGU picklists for the applicant form (CLAUDE.md 7o follow-up,
 * migration 0021) -- replaces san-miguel-form-options.ts's hardcoded
 * BARANGAY_OPTIONS/NATURE_OF_BUSINESS_OPTIONS as the runtime source, now
 * that a real second client is being onboarded and would otherwise see
 * San Miguel's own barangay names on their own applicants' form.
 *
 * The two option types get different empty-list behavior, deliberately:
 *
 * - barangayOptions: no fallback. A barangay list has no sensible default
 *   across LGUs -- showing San Miguel's real barangay names to a
 *   different municipality's citizens would be actively wrong, not just
 *   generic. apply/page.tsx's caller degrades the barangay field to free
 *   text when this comes back empty, rather than showing an empty or
 *   wrong dropdown.
 * - natureOfBusinessOptions: falls back to San Miguel's list
 *   (NATURE_OF_BUSINESS_OPTIONS, still exported from san-miguel-form-
 *   options.ts for exactly this purpose) when a client hasn't set their
 *   own. Business-type taxonomy is generic enough to work as a
 *   reasonable out-of-the-box default -- unlike a barangay list -- so a
 *   new client's form works immediately rather than being blocked on
 *   this. Flagged, not hidden: application-form-logic.ts's conditional
 *   show/hide rules (e.g. "Billiard Hall" -> show billiardTableCount) are
 *   hardcoded against these exact strings, sourced from San Miguel's own
 *   real form (CLAUDE.md 7d) -- they keep working for any client using
 *   this default list, but a client that later customizes their own
 *   nature-of-business wording would silently stop matching those rules.
 *   Genuinely generalizing that conditional-logic engine per client would
 *   need each client's own real live form export (7d/7b's standing rule:
 *   never guess a new LGU's form structure from a derived source) --
 *   out of scope for this pass, which is about the picklist values
 *   actually being correct per client, not rebuilding the whole form
 *   per client.
 */
export async function getLguFormOptions(supabase: SupabaseClient, lguId: string): Promise<LguFormOptions> {
  const { data } = await supabase
    .from("lgu_form_options")
    .select("option_type, value")
    .eq("lgu_id", lguId)
    .order("sort_order", { ascending: true });

  const barangayOptions = (data ?? []).filter((r) => r.option_type === "barangay").map((r) => r.value);
  const customNature = (data ?? []).filter((r) => r.option_type === "nature_of_business").map((r) => r.value);

  return {
    barangayOptions,
    natureOfBusinessOptions: customNature.length > 0 ? customNature : [...NATURE_OF_BUSINESS_OPTIONS],
  };
}
