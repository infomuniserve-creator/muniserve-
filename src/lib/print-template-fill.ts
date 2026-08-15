import { PDFDocument, PDFTextField, type PDFField } from "pdf-lib";
import { PRINT_TEMPLATE_FIELDS, type PrintTemplateFieldKey } from "@/lib/print-certificate";

export type TemplateFieldInfo = { name: string; isTextField: boolean };
export type InspectResult = { ok: true; fields: TemplateFieldInfo[] } | { ok: false; error: string };

/**
 * Reads an uploaded PDF's own form-field names back out (CLAUDE.md 7y) --
 * this is what lets the mapping UI show BPLO their *actual* field names
 * rather than requiring them to guess a fixed naming convention. Only
 * `PDFTextField`s are fillable by this pipeline (checkboxes/dropdowns
 * aren't a shape any of this project's data needs) -- reported back as
 * `isTextField: false` rather than silently omitted, so BPLO can see
 * *why* a field they expected to map isn't offered as an option.
 */
export async function inspectPdfFields(pdfBytes: Uint8Array): Promise<InspectResult> {
  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes);
  } catch (err) {
    return { ok: false, error: `Couldn't read this file as a PDF: ${err instanceof Error ? err.message : String(err)}` };
  }

  let fields: PDFField[];
  try {
    fields = pdfDoc.getForm().getFields();
  } catch {
    fields = [];
  }

  if (fields.length === 0) {
    return {
      ok: false,
      error:
        "This PDF has no fillable form fields. It needs named text fields (e.g. added in Adobe Acrobat's \"Prepare Form\" tool, or a similar free PDF editor) before MuniServe can fill it in automatically.",
    };
  }

  return { ok: true, fields: fields.map((f) => ({ name: f.getName(), isTextField: f instanceof PDFTextField })) };
}

const VALID_CANONICAL_KEYS = new Set<string>(PRINT_TEMPLATE_FIELDS.map((f) => f.key));

/** Used by the publish action to re-validate a client-submitted mapping against the file's real fields -- never trusts what the browser echoed back. */
export function validateMapping(mapping: Record<string, string>, fields: TemplateFieldInfo[]): string | null {
  const textFieldNames = new Set(fields.filter((f) => f.isTextField).map((f) => f.name));
  for (const [fieldName, canonicalKey] of Object.entries(mapping)) {
    if (!textFieldNames.has(fieldName)) return `"${fieldName}" isn't a text field in this file.`;
    if (!VALID_CANONICAL_KEYS.has(canonicalKey)) return `"${canonicalKey}" isn't a known data field.`;
  }
  return null;
}

/**
 * Fills a BPLO-uploaded template with real application data and
 * flattens it (the filled text becomes part of the static page content,
 * not an editable field anymore) so it prints consistently everywhere.
 * Unmapped fields, and any field whose value is an empty string (e.g.
 * mayor_name when the LGU hasn't set one in Settings), are left
 * untouched rather than overwritten with a blank -- a template's own
 * printed label/placeholder text for that field stays visible instead of
 * disappearing. A field that no longer exists or isn't a text field
 * (renamed/replaced since the mapping was saved) is skipped rather than
 * failing the whole document -- a stale single mapping entry shouldn't
 * block printing everything else.
 */
export async function fillCustomTemplate(pdfBytes: Uint8Array, mapping: Record<string, string>, values: Record<PrintTemplateFieldKey, string>): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();

  for (const [fieldName, canonicalKey] of Object.entries(mapping)) {
    const value = values[canonicalKey as PrintTemplateFieldKey];
    if (!value) continue;
    try {
      const field = form.getTextField(fieldName);
      field.setText(value);
    } catch {
      continue;
    }
  }

  try {
    form.flatten();
  } catch {
    // Some field types resist flattening -- leave the form as-filled
    // rather than fail the whole document over a cosmetic step.
  }

  return pdfDoc.save();
}
