import { createServiceClient } from "@/lib/supabase/service";

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
