"use server";

import { getCurrentStaff } from "@/lib/staff";
import { actorLabelFor, logAuditEvent } from "@/lib/audit-log";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { inspectPdfFields, validateMapping, type TemplateFieldInfo } from "@/lib/print-template-fill";
import { revalidatePath } from "next/cache";

/**
 * Self-service permit print template (CLAUDE.md 7y) -- BPLO uploads a
 * fillable PDF, maps its own field names to MuniServe's data, and every
 * future application at "For Printing" uses it automatically instead of
 * the generated fallback (src/lib/print-certificate.ts). Same
 * preview-before-publish safety shape as the fee-rule CSV import
 * (src/lib/fee-rule-import.ts): nothing is saved until BPLO explicitly
 * confirms the mapping they were shown.
 */

export type PreviewResult = { ok: true; fields: TemplateFieldInfo[] } | { ok: false; error: string };

/** Parse-only, no writes -- reads the uploaded file's real field names so the mapping UI can show them instead of requiring a guessed naming convention. */
export async function previewPrintTemplate(formData: FormData): Promise<PreviewResult> {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file was uploaded." };
  if (file.type !== "application/pdf") return { ok: false, error: "Please upload a PDF file." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  return inspectPdfFields(bytes);
}

/**
 * Re-reads the file's fields server-side rather than trusting the
 * client's echoed-back list (same reasoning as finalizeAssessment/the
 * fee-rule import's publish step -- a browser value is technically
 * editable), validates the mapping against those real fields, uploads to
 * the private permit-print-templates bucket (migration 0034), and saves
 * the path + mapping on this LGU's own row.
 */
export async function publishPrintTemplate(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file was uploaded." };
  if (file.type !== "application/pdf") return { ok: false, error: "Please upload a PDF file." };

  let mapping: Record<string, string>;
  try {
    mapping = JSON.parse(String(formData.get("mapping") ?? "{}"));
  } catch {
    return { ok: false, error: "Invalid mapping data." };
  }
  if (Object.keys(mapping).length === 0) {
    return { ok: false, error: "Map at least one field before saving." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = await inspectPdfFields(bytes);
  if (!inspected.ok) return inspected;

  const mappingError = validateMapping(mapping, inspected.fields);
  if (mappingError) return { ok: false, error: mappingError };

  const service = createServiceClient();
  const path = `${staff.lgu_id}/template.pdf`;
  const { error: uploadError } = await service.storage.from("permit-print-templates").upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) return { ok: false, error: uploadError.message };

  const supabase = await createClient();
  const { error } = await supabase.from("lgus").update({ print_template_path: path, print_template_field_mapping: mapping }).eq("id", staff.lgu_id);
  if (error) return { ok: false, error: error.message };

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "print_template_updated",
    summary: `Permit print template uploaded (${Object.keys(mapping).length} field${Object.keys(mapping).length === 1 ? "" : "s"} mapped)`,
    details: { fieldCount: Object.keys(mapping).length },
  });

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

/** Reverts to the generated fallback certificate -- soft, matching this schema's standing convention (clears the reference, doesn't need to delete the storage object for correctness, though it does so best-effort to avoid an orphaned file). */
export async function removePrintTemplate(): Promise<void> {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const supabase = await createClient();
  const { error } = await supabase.from("lgus").update({ print_template_path: null, print_template_field_mapping: null }).eq("id", staff.lgu_id);
  if (error) throw error;

  const service = createServiceClient();
  await service.storage.from("permit-print-templates").remove([`${staff.lgu_id}/template.pdf`]).catch(() => {});

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "print_template_updated",
    summary: "Permit print template removed -- reverted to the generated default certificate",
  });

  revalidatePath("/dashboard/settings");
}
