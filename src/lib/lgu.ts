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
  mayorName: string | null; // migration 0033 -- e.g. "John A. Alvarez", for the pre-signature print certificate (CLAUDE.md 7x). No generic fallback -- unlike bploOfficeName, there's no sensible default for a person's actual name.
  printTemplatePath: string | null; // migration 0034 -- storage path in the private permit-print-templates bucket, null until BPLO uploads one (CLAUDE.md 7y)
  printTemplateFieldMapping: Record<string, string> | null; // { "<PDF field name>": "<canonical data key>" }, built from that specific upload's own field names
  buildingPermitFeeEnabled: boolean; // migration 0035 -- off by default (CLAUDE.md 7aa); when on, Engineering gets an amount field on their review and it's included in the assessment total
  buildingPermitFeeLabel: string; // BPLO-editable, e.g. "Building Permit Fee" -- not hardcoded, since wording genuinely varies (San Miguel's own materials separately mention a flat "Building Inspection Fee")
  isPaused: boolean; // migration 0020 -- dashboard/layout.tsx blocks real staff (not a platform-admin proxy) when true
  automatedAssessmentEnabled: boolean; // migration 0026 -- BPLO's own manual-override switch, off means the assessment card falls back to hand-entered amounts for the LBT/Mayor's Permit/graduated-regulatory lines
  cedulaIncludedOnline: boolean; // migration 0038 -- true when both of this LGU's CEDULA fee_rules rows have delivery_mode = 'online' (fee-engine.ts's own source of truth, not a separate lgus column); when true, CEDULA joins the online total and the application form skips the upload requirement, since there's no pre-existing document to upload
  treasurerName: string | null; // migration 0039 -- e.g. "Pablo R. Sarmiento", for the Order of Payment's "Reviewed & Recommended for Approval" line. Same "no generic fallback" reasoning as mayorName.
  senderName: string | null; // migration 0040 -- this LGU's own approved Semaphore Sender Name (e.g. "SANMIGUELBPLO"), null until purchased/registered. notifications.ts uses this to decide both the Semaphore `sendername` param and whether the "BPLO: " fallback text prefix is still needed.
  referencePrefix: string; // migration 0051 -- the existing short_code column, now exposed as the BPLO-editable "field 1" of Permit No. Format (e.g. "SMB"). Falls back to "APP" (matching generate_application_reference()'s own SQL-side coalesce) rather than null -- a permit number always needs a real prefix, there's no "blank" state to model.
  referenceYearDigits: 2 | 4; // migration 0051 -- "field 2" width, 2-digit ("26") or 4-digit ("2026") -- the year itself always stays live-computed, this only controls how many digits of it are shown
  referenceCounterDigits: number; // migration 0051 -- "field 3" zero-padding width (3-8), e.g. 5 -> "00056"
  lbtBiannualReminderDates: string[]; // migration 0052 -- 'MM-DD' strings, e.g. ["07-05"]. Empty = not configured, no reminders scheduled.
  lbtQuarterlyReminderDates: string[]; // e.g. ["04-05", "07-05", "10-05"]
};

const LGU_SELECT_COLUMNS =
  "id, name, province, subdomain, display_name, bplo_office_name, mayor_name, print_template_path, print_template_field_mapping, building_permit_fee_enabled, building_permit_fee_label, is_paused, automated_assessment_enabled, treasurer_name, sender_name, short_code, reference_year_digits, reference_counter_digits, lbt_biannual_reminder_dates, lbt_quarterly_reminder_dates";

/** Falls back to a Municipality-shaped default if display_name/bplo_office_name (migration 0017) were never filled in for this LGU -- onboarding a new LGU shouldn't silently break letterheads just because someone forgot this one field. */
function withFallback(row: {
  id: string; name: string; province: string | null; subdomain: string | null; display_name: string | null; bplo_office_name: string | null; mayor_name: string | null;
  print_template_path: string | null; print_template_field_mapping: Record<string, string> | null;
  building_permit_fee_enabled: boolean; building_permit_fee_label: string | null; is_paused: boolean; automated_assessment_enabled: boolean; treasurer_name: string | null; sender_name: string | null;
  short_code: string | null; reference_year_digits: number; reference_counter_digits: number;
  lbt_biannual_reminder_dates: string[] | null; lbt_quarterly_reminder_dates: string[] | null;
}, cedulaIncludedOnline: boolean): LguDisplay {
  return {
    id: row.id,
    name: row.name,
    province: row.province,
    subdomain: row.subdomain,
    displayName: row.display_name ?? `Municipality of ${row.name}${row.province ? ` ${row.province}` : ""}`,
    bploOfficeName: row.bplo_office_name ?? "Office of the Municipal Business Permit and Licensing Officer",
    mayorName: row.mayor_name,
    printTemplatePath: row.print_template_path,
    printTemplateFieldMapping: row.print_template_field_mapping,
    buildingPermitFeeEnabled: row.building_permit_fee_enabled,
    buildingPermitFeeLabel: row.building_permit_fee_label ?? "Building Permit Fee",
    isPaused: row.is_paused,
    automatedAssessmentEnabled: row.automated_assessment_enabled,
    cedulaIncludedOnline,
    treasurerName: row.treasurer_name,
    senderName: row.sender_name,
    referencePrefix: row.short_code ?? "APP",
    referenceYearDigits: row.reference_year_digits === 2 ? 2 : 4,
    referenceCounterDigits: row.reference_counter_digits,
    lbtBiannualReminderDates: row.lbt_biannual_reminder_dates ?? [],
    lbtQuarterlyReminderDates: row.lbt_quarterly_reminder_dates ?? [],
  };
}

/** Both of an LGU's CEDULA rows (individual/juridical) are always toggled together (settings/actions.ts's setCedulaIncludedOnline), so checking one is enough -- defaults to false (today's reference_only behavior) if somehow neither row exists yet. Exported separately from getLguDisplay() for callers (submit-application/route.ts) that need just this one flag without the rest of LguDisplay's own lgus-table query. */
export async function getCedulaIncludedOnline(supabase: SupabaseClient, lguId: string): Promise<boolean> {
  const { data } = await supabase
    .from("fee_rules")
    .select("delivery_mode")
    .eq("lgu_id", lguId)
    .eq("fee_category", "cedula")
    .limit(1)
    .maybeSingle();
  return data?.delivery_mode === "online";
}

/** Takes the caller's own client (staff's RLS-scoped session, or service-role for pre-auth pages) -- staff already have a "view their own lgu" SELECT policy (migration 0002), no new policy needed. */
export async function getLguDisplay(supabase: SupabaseClient, lguId: string): Promise<LguDisplay> {
  const { data, error } = await supabase.from("lgus").select(LGU_SELECT_COLUMNS).eq("id", lguId).single();
  if (error || !data) throw new Error("LGU not found");
  const cedulaIncludedOnline = await getCedulaIncludedOnline(supabase, lguId);
  return withFallback(data, cedulaIncludedOnline);
}

/** The default LGU's display info -- used by resolveLguDisplay() as the fallback for a host that doesn't match any LGU's own subdomain. */
export async function getPilotLguDisplay(): Promise<LguDisplay> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("lgus").select(LGU_SELECT_COLUMNS).eq("name", "San Miguel").single();
  if (error || !data) throw new Error("Pilot LGU (San Miguel) not found");
  const cedulaIncludedOnline = await getCedulaIncludedOnline(supabase, data.id);
  return withFallback(data, cedulaIncludedOnline);
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

/**
 * A lightweight is_paused-only check for routes that already have an
 * lguId from resolveLguId() and don't need the rest of LguDisplay (CLAUDE.md
 * 7o follow-up) -- e.g. submit-application/route.ts, which rejects a
 * submission outright when the LGU is paused. apply/page.tsx doesn't need
 * this separately since resolveLguDisplay() already includes isPaused.
 */
export async function isLguPaused(lguId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("lgus").select("is_paused").eq("id", lguId).maybeSingle();
  return data?.is_paused ?? false;
}
