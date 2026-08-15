"use client";

import { useRef, useState } from "react";
import { Card, MiniButton, PrimaryButton, TonePill } from "../ui";
import { previewPrintTemplate, publishPrintTemplate, removePrintTemplate } from "./print-template-actions";
import { PRINT_TEMPLATE_FIELDS } from "@/lib/print-certificate";
import type { TemplateFieldInfo } from "@/lib/print-template-fill";

type Stage =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "mapping"; file: File; fields: TemplateFieldInfo[]; mapping: Record<string, string> }
  | { kind: "error"; message: string }
  | { kind: "publishing" }
  | { kind: "published" };

/**
 * "Permit Print Template" -- BPLO uploads a fillable PDF, maps its own
 * field names to MuniServe's data, and every future application at "For
 * Printing" uses it automatically (CLAUDE.md 7y). A client component
 * (like FeeRuleImportCard) for the same reason: upload -> preview ->
 * explicit confirm is a real multi-step interaction, not something a
 * plain form submit can do -- nothing here writes to the database until
 * "Save template" is clicked.
 */
export function PrintTemplateUpload({ hasTemplate }: { hasTemplate: boolean }) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStage({ kind: "reading" });
    const formData = new FormData();
    formData.set("file", file);
    const result = await previewPrintTemplate(formData);
    if (!result.ok) {
      setStage({ kind: "error", message: result.error });
      return;
    }
    setStage({ kind: "mapping", file, fields: result.fields, mapping: {} });
  }

  function setFieldMapping(fieldName: string, canonicalKey: string) {
    if (stage.kind !== "mapping") return;
    const mapping = { ...stage.mapping };
    if (canonicalKey === "") delete mapping[fieldName];
    else mapping[fieldName] = canonicalKey;
    setStage({ ...stage, mapping });
  }

  async function handlePublish() {
    if (stage.kind !== "mapping") return;
    setStage({ kind: "publishing" });
    const formData = new FormData();
    formData.set("file", stage.file);
    formData.set("mapping", JSON.stringify(stage.mapping));
    const result = await publishPrintTemplate(formData);
    if (!result.ok) {
      setStage({ kind: "error", message: result.error });
      return;
    }
    setStage({ kind: "published" });
  }

  async function handleRemove() {
    await removePrintTemplate();
    setStage({ kind: "idle" });
  }

  function reset() {
    setStage({ kind: "idle" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13.5px] font-bold text-ink">Your own certificate design</p>
          <p className="text-[12px] text-ink-soft">
            Upload a PDF with named fillable fields (made in Adobe Acrobat or a similar PDF editor) and it replaces the generated certificate at &ldquo;For Printing.&rdquo;
          </p>
        </div>
        {hasTemplate && stage.kind === "idle" && <TonePill label="Custom template active" tone="good" />}
      </div>

      {(stage.kind === "idle" || stage.kind === "reading") && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-border-strong bg-surface-2 px-4 py-3 text-[12.5px] font-bold text-ink hover:bg-surface-3">
            {stage.kind === "reading" ? "Reading file..." : hasTemplate ? "Upload a replacement PDF" : "Upload a PDF"}
            <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={handleFileChange} disabled={stage.kind === "reading"} />
          </label>
          {hasTemplate && stage.kind === "idle" && (
            <MiniButton tone="bad" onClick={handleRemove}>
              Remove -- use the generated certificate instead
            </MiniButton>
          )}
        </div>
      )}

      {stage.kind === "error" && (
        <div className="rounded-2xl border border-bad bg-bad-bg p-4">
          <p className="text-[12.5px] font-bold text-bad-ink">{stage.message}</p>
          <MiniButton tone="neutral" className="mt-3" onClick={reset}>
            Try another file
          </MiniButton>
        </div>
      )}

      {stage.kind === "mapping" && (
        <div className="rounded-2xl border border-info bg-info-bg p-4">
          <p className="mb-1 text-[12.5px] font-bold text-info-ink">
            Found {stage.fields.length} field{stage.fields.length === 1 ? "" : "s"} in {stage.file.name} -- choose what each one should be filled with.
          </p>
          <div className="mt-2 flex flex-col divide-y divide-border">
            {stage.fields.map((f) => (
              <div key={f.name} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-bold text-ink">{f.name}</p>
                  {!f.isTextField && <p className="text-[11px] text-ink-faint">Not a text field -- can&rsquo;t be auto-filled.</p>}
                </div>
                <select
                  disabled={!f.isTextField}
                  defaultValue=""
                  onChange={(e) => setFieldMapping(f.name, e.target.value)}
                  className="h-9 w-64 rounded-xl border border-border-strong bg-surface px-2.5 text-[12.5px] text-ink disabled:opacity-50"
                >
                  <option value="">— don&rsquo;t fill this field —</option>
                  {PRINT_TEMPLATE_FIELDS.map((pf) => (
                    <option key={pf.key} value={pf.key}>{pf.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <PrimaryButton onClick={handlePublish} disabled={Object.keys(stage.mapping).length === 0}>
              Save template
            </PrimaryButton>
            <MiniButton tone="neutral" onClick={reset}>
              Cancel
            </MiniButton>
          </div>
        </div>
      )}

      {stage.kind === "publishing" && <p className="text-[13px] font-bold text-ink-soft">Saving...</p>}

      {stage.kind === "published" && (
        <div className="rounded-2xl border border-good bg-good-bg p-4">
          <p className="text-[13px] font-bold text-good-ink">Template saved -- every application reaching &ldquo;For Printing&rdquo; now uses it.</p>
          <MiniButton tone="neutral" className="mt-2" onClick={reset}>
            Upload a different file
          </MiniButton>
        </div>
      )}
    </Card>
  );
}
