"use server";

import { requireUnpausedStaff } from "@/lib/staff";
import { actorLabelFor, logAuditEvent } from "@/lib/audit-log";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

const ALLOWED_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_BYTES = 2 * 1024 * 1024;
const LOGO_EXTENSIONS = ["png", "jpg", "webp"];

/**
 * LGU Logo (2026-08-21, CLAUDE.md) -- shown in the header of every
 * applicant-facing email (applicant-email-template.ts). Public bucket
 * (migration 0059, lgu-logos), same reasoning as permit-pdfs: an email
 * client fetches this image directly with no auth, so it can't be a
 * signed URL. A single-file upload with no preview/mapping step (unlike
 * PrintTemplateUpload) -- there's nothing to configure beyond the image
 * itself.
 */
export async function updateLguLogo(formData: FormData): Promise<{ ok: true; logoUrl: string } | { ok: false; error: string }> {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file was chosen." };
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) return { ok: false, error: "Please upload a PNG, JPG, or WEBP image." };
  if (file.size > MAX_BYTES) return { ok: false, error: "That image is too large — please use one under 2MB." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const path = `${staff.lgu_id}/logo.${ext}`;

  const service = createServiceClient();
  // A previous logo may have used a different extension (replacing a .png
  // with a .jpg, say) -- clear every possible extension first so an old
  // file never lingers alongside the new one under a different path.
  await service.storage.from("lgu-logos").remove(LOGO_EXTENSIONS.map((e) => `${staff.lgu_id}/logo.${e}`)).catch(() => {});
  const { error: uploadError } = await service.storage.from("lgu-logos").upload(path, bytes, { contentType: file.type, upsert: true });
  if (uploadError) return { ok: false, error: uploadError.message };

  // A cache-busting suffix, not a cosmetic flourish -- replacing a logo
  // reuses the exact same path (upsert), so without this a browser or
  // mail client that already cached the old image at that URL would keep
  // showing it after a real replacement.
  const logoUrl = `${service.storage.from("lgu-logos").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;

  const supabase = await createClient();
  const { error } = await supabase.from("lgus").update({ logo_url: logoUrl }).eq("id", staff.lgu_id);
  if (error) return { ok: false, error: error.message };

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "lgu_logo_updated",
    summary: "LGU logo uploaded/replaced",
  });

  revalidatePath("/dashboard/settings");
  return { ok: true, logoUrl };
}

export async function removeLguLogo(): Promise<void> {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const supabase = await createClient();
  const { error } = await supabase.from("lgus").update({ logo_url: null }).eq("id", staff.lgu_id);
  if (error) throw error;

  const service = createServiceClient();
  await service.storage.from("lgu-logos").remove(LOGO_EXTENSIONS.map((e) => `${staff.lgu_id}/logo.${e}`)).catch(() => {});

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "lgu_logo_updated",
    summary: "LGU logo removed",
  });

  revalidatePath("/dashboard/settings");
}
