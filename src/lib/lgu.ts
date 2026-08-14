import { createServiceClient } from "@/lib/supabase/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The whole app is currently single-tenant (San Miguel only) -- there's no
 * URL-based LGU selection yet (e.g. a subdomain or path segment). This is
 * a placeholder until that routing exists; every applicant-facing route
 * that needs an lgu_id calls this rather than hardcoding San Miguel's
 * name/id directly, so swapping in real multi-LGU routing later is a
 * one-function change, not a find-and-replace across routes.
 */
export async function getPilotLguId(): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("lgus")
    .select("id")
    .eq("name", "San Miguel")
    .single();
  if (error || !data) throw new Error("Pilot LGU (San Miguel) not found");
  return data.id;
}

/**
 * Everything the UI needs to render an LGU's letterhead/subtitle without
 * hardcoding San Miguel's name anywhere (CLAUDE.md section 7n). Fixes the
 * *display text* only -- which LGU a given request belongs to is still
 * resolved via getPilotLguId()/staff.lgu_id exactly as before; this
 * doesn't add multi-tenant routing, just makes what gets displayed once
 * an lgu_id is known come from data instead of a string literal.
 */
export type LguDisplay = {
  id: string;
  name: string; // short form, e.g. "San Miguel" -- used for "San Miguel, Bulacan" style subtitles
  province: string | null;
  displayName: string; // e.g. "Municipality of San Miguel Bulacan" -- letterhead line
  bploOfficeName: string; // e.g. "Office of the Municipal Business Permit and Licensing Officer"
};

/** Falls back to a Municipality-shaped default if display_name/bplo_office_name (migration 0017) were never filled in for this LGU -- onboarding a new LGU shouldn't silently break letterheads just because someone forgot this one field. */
function withFallback(row: { id: string; name: string; province: string | null; display_name: string | null; bplo_office_name: string | null }): LguDisplay {
  return {
    id: row.id,
    name: row.name,
    province: row.province,
    displayName: row.display_name ?? `Municipality of ${row.name}${row.province ? ` ${row.province}` : ""}`,
    bploOfficeName: row.bplo_office_name ?? "Office of the Municipal Business Permit and Licensing Officer",
  };
}

/** Takes the caller's own client (staff's RLS-scoped session, or service-role for pre-auth pages) -- staff already have a "view their own lgu" SELECT policy (migration 0002), no new policy needed. */
export async function getLguDisplay(supabase: SupabaseClient, lguId: string): Promise<LguDisplay> {
  const { data, error } = await supabase
    .from("lgus")
    .select("id, name, province, display_name, bplo_office_name")
    .eq("id", lguId)
    .single();
  if (error || !data) throw new Error("LGU not found");
  return withFallback(data);
}

/** For pre-auth pages (landing, login, the applicant form before any session exists) that have no lgu_id of their own yet -- same placeholder-until-real-routing caveat as getPilotLguId(). */
export async function getPilotLguDisplay(): Promise<LguDisplay> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("lgus")
    .select("id, name, province, display_name, bplo_office_name")
    .eq("name", "San Miguel")
    .single();
  if (error || !data) throw new Error("Pilot LGU (San Miguel) not found");
  return withFallback(data);
}
