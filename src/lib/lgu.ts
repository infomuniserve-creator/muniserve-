import { createServiceClient } from "@/lib/supabase/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Real multi-tenant routing now exists (CLAUDE.md section 7o) --
 * resolveLguId()/resolveLguDisplay() below are what pre-auth pages and
 * data-writing applicant routes should call. getPilotLguId() stays as
 * the fallback for a request that doesn't match any LGU's own subdomain
 * (portal.muniserve.ph, localhost, or an unrecognized host) -- it's no
 * longer the *only* mechanism, just the default one.
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
  subdomain: string | null; // e.g. "sanmiguel" (migration 0018) -- lets a caller tell "this really is their own subdomain" apart from the pilot-LGU fallback
  displayName: string; // e.g. "Municipality of San Miguel Bulacan" -- letterhead line
  bploOfficeName: string; // e.g. "Office of the Municipal Business Permit and Licensing Officer"
};

/** Falls back to a Municipality-shaped default if display_name/bplo_office_name (migration 0017) were never filled in for this LGU -- onboarding a new LGU shouldn't silently break letterheads just because someone forgot this one field. */
function withFallback(row: { id: string; name: string; province: string | null; subdomain: string | null; display_name: string | null; bplo_office_name: string | null }): LguDisplay {
  return {
    id: row.id,
    name: row.name,
    province: row.province,
    subdomain: row.subdomain,
    displayName: row.display_name ?? `Municipality of ${row.name}${row.province ? ` ${row.province}` : ""}`,
    bploOfficeName: row.bplo_office_name ?? "Office of the Municipal Business Permit and Licensing Officer",
  };
}

/** Takes the caller's own client (staff's RLS-scoped session, or service-role for pre-auth pages) -- staff already have a "view their own lgu" SELECT policy (migration 0002), no new policy needed. */
export async function getLguDisplay(supabase: SupabaseClient, lguId: string): Promise<LguDisplay> {
  const { data, error } = await supabase
    .from("lgus")
    .select("id, name, province, subdomain, display_name, bplo_office_name")
    .eq("id", lguId)
    .single();
  if (error || !data) throw new Error("LGU not found");
  return withFallback(data);
}

/** The default LGU's display info -- used by resolveLguDisplay() as the fallback for a host that doesn't match any LGU's own subdomain. */
export async function getPilotLguDisplay(): Promise<LguDisplay> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("lgus")
    .select("id, name, province, subdomain, display_name, bplo_office_name")
    .eq("name", "San Miguel")
    .single();
  if (error || !data) throw new Error("Pilot LGU (San Miguel) not found");
  return withFallback(data);
}

/**
 * Subdomains that are the app's own generic/shared hosts, never an LGU's
 * own slug -- portal.muniserve.ph (the shared staff/pilot-applicant
 * domain), www, and links (the project owner's existing, unrelated GHL
 * setup on that subdomain, see CLAUDE.md 7l).
 */
const RESERVED_SUBDOMAINS = new Set(["portal", "www", "links", "app"]);

/** Extracts an LGU's slug from a Host header value (e.g. "malolos.muniserve.ph:443" -> "malolos"), or null if it isn't a recognized per-LGU subdomain. No proxy/middleware file needed for this -- next/headers already exposes the raw incoming Host header to any Server Component or Route Handler. */
function extractLguSubdomain(host: string | null): string | null {
  if (!host) return null;
  const hostname = host.split(":")[0].toLowerCase();
  const suffix = ".muniserve.ph";
  if (!hostname.endsWith(suffix)) return null;
  const subdomain = hostname.slice(0, -suffix.length);
  return RESERVED_SUBDOMAINS.has(subdomain) ? null : subdomain;
}

/**
 * The real multi-tenant resolver (CLAUDE.md 7o): a new LGU's own
 * subdomain (set via /admin, the platform-admin UI) routes their
 * applicants to their own data/branding, with no code change needed per
 * client. Falls back to the pilot LGU for portal.muniserve.ph, localhost,
 * or any host that doesn't match a known subdomain.
 *
 * Pass `request.headers.get("host")` from a Route Handler, or
 * `(await headers()).get("host")` (next/headers) from a Server Component.
 */
export async function resolveLguId(host: string | null): Promise<string> {
  const subdomain = extractLguSubdomain(host);
  if (subdomain) {
    const supabase = createServiceClient();
    const { data } = await supabase.from("lgus").select("id").eq("subdomain", subdomain).maybeSingle();
    if (data) return data.id;
  }
  return getPilotLguId();
}

/** Same resolution as resolveLguId(), returning the full display info instead of just the id. */
export async function resolveLguDisplay(host: string | null): Promise<LguDisplay> {
  const lguId = await resolveLguId(host);
  const supabase = createServiceClient();
  return getLguDisplay(supabase, lguId);
}
