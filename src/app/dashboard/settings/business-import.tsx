"use client";

import { useRef, useState } from "react";
import { Card, MiniButton, PrimaryButton, TonePill } from "../ui";
import { previewBusinessImport, publishBusinessImport, type BusinessImportPreview } from "./business-import-actions";

type Stage =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "previewed"; csvText: string; fileName: string; preview: Extract<BusinessImportPreview, { ok: true }> }
  | { kind: "error"; errors: string[] }
  | { kind: "publishing" }
  | { kind: "published"; importedCount: number; skippedCount: number; claimedCount: number; warnings: string[] };

/**
 * Import Businesses (2026-08-18) -- lets a new LGU upload their existing
 * business roster themselves instead of needing a developer to hand-write
 * an import script, the same self-service shape FeeRuleImportCard already
 * established for fee rates. See business-import.ts/business-import-
 * actions.ts for the parsing/write logic.
 */
export function BusinessImportCard() {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [taxYear, setTaxYear] = useState(() => new Date().getFullYear());
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStage({ kind: "reading" });
    const csvText = await file.text();
    const result = await previewBusinessImport(csvText);
    if (!result.ok) {
      setStage({ kind: "error", errors: result.errors });
      return;
    }
    setStage({ kind: "previewed", csvText, fileName: file.name, preview: result });
  }

  async function handlePublish() {
    if (stage.kind !== "previewed") return;
    setStage({ kind: "publishing" });
    const result = await publishBusinessImport(stage.csvText, taxYear);
    if (!result.ok) {
      setStage({ kind: "error", errors: result.errors });
      return;
    }
    setStage({ kind: "published", importedCount: result.importedCount, skippedCount: result.skippedCount, claimedCount: result.claimedCount, warnings: result.warnings });
  }

  function reset() {
    setStage({ kind: "idle" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13.5px] font-bold text-ink">Import Businesses</p>
          <p className="max-w-md text-[12px] text-ink-soft">
            Upload your existing business roster from Excel/CSV -- if a row has a mobile number, that business is claimed immediately and its owner can renew online right away; a row with no number imports as unclaimed, same as any other legacy business.
          </p>
        </div>
        <a
          href="/api/dashboard/business-import-template"
          className="rounded-xl border border-border-strong px-3 py-2 text-[12.5px] font-bold text-ink-soft hover:bg-surface-2"
        >
          Download template (CSV)
        </a>
      </div>

      {(stage.kind === "idle" || stage.kind === "reading") && (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-bold text-ink-soft">Tax year this data is for</span>
            <input
              type="number"
              value={taxYear}
              onChange={(e) => setTaxYear(Number(e.target.value))}
              className="h-9 w-28 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink"
            />
          </label>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-border-strong bg-surface-2 px-4 py-6 text-center hover:bg-surface-3">
            <span className="text-[13px] font-bold text-ink">{stage.kind === "reading" ? "Reading file..." : "Click to choose a CSV file"}</span>
            <span className="text-[11.5px] text-ink-faint">Must be the same column format as the downloaded template.</span>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} disabled={stage.kind === "reading"} />
          </label>
        </>
      )}

      {stage.kind === "error" && (
        <div className="rounded-2xl border border-bad bg-bad-bg p-4">
          <p className="mb-1.5 text-[12.5px] font-bold text-bad-ink">This file can&rsquo;t be used yet -- nothing was changed:</p>
          <ul className="list-inside list-disc space-y-1 text-[12.5px] text-bad-ink">
            {stage.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <MiniButton tone="neutral" className="mt-3" onClick={reset}>
            Try another file
          </MiniButton>
        </div>
      )}

      {stage.kind === "previewed" && (
        <div className="rounded-2xl border border-info bg-info-bg p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <TonePill label={`${stage.preview.rowCount} business${stage.preview.rowCount === 1 ? "" : "es"} found`} tone="info" />
            {stage.preview.claimCount > 0 && <TonePill label={`${stage.preview.claimCount} claimed immediately`} tone="good" />}
            <span className="text-[12px] font-bold text-ink-soft">from {stage.fileName} -- tax year {taxYear}</span>
          </div>
          <p className="mb-1.5 text-[12.5px] font-bold text-info-ink">Review before this goes live:</p>
          <ul className="max-h-64 list-inside list-disc space-y-1 overflow-y-auto text-[12.5px] text-ink">
            {stage.preview.summaries.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          {stage.preview.warnings.length > 0 && (
            <div className="mt-3 rounded-xl border border-warn bg-warn-bg p-3">
              <p className="mb-1 text-[12px] font-bold text-warn-ink">Worth double-checking:</p>
              <ul className="list-inside list-disc space-y-1 text-[12px] text-warn-ink">
                {stage.preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <PrimaryButton onClick={handlePublish}>Looks right -- import</PrimaryButton>
            <MiniButton tone="neutral" onClick={reset}>
              Cancel
            </MiniButton>
          </div>
        </div>
      )}

      {stage.kind === "publishing" && <p className="text-[13px] font-bold text-ink-soft">Importing...</p>}

      {stage.kind === "published" && (
        <div className="rounded-2xl border border-good bg-good-bg p-4">
          <p className="text-[13px] font-bold text-good-ink">
            Imported {stage.importedCount} business{stage.importedCount === 1 ? "" : "es"} ({stage.claimedCount} claimed immediately
            {stage.skippedCount > 0 ? `, ${stage.skippedCount} already on file were skipped` : ""}).
          </p>
          {stage.warnings.length > 0 && (
            <ul className="mt-2 list-inside list-disc space-y-1 text-[12px] text-good-ink">
              {stage.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <MiniButton tone="neutral" className="mt-2" onClick={reset}>
            Import another file
          </MiniButton>
        </div>
      )}
    </Card>
  );
}
