"use client";

import { useRef, useState } from "react";
import { Card, MiniButton, PrimaryButton, TonePill } from "../ui";
import { previewFeeRuleImport, publishFeeRuleImport, type FeeImportPreview } from "./actions";
import type { FeeType } from "@/lib/fee-rule-import";

type Stage = { kind: "idle" } | { kind: "reading" } | { kind: "previewed"; csvText: string; fileName: string; preview: Extract<FeeImportPreview, { ok: true }> } | { kind: "error"; errors: string[] } | { kind: "publishing" } | { kind: "published"; ruleCount: number };

/**
 * Business Tax & Mayor's Permit Fee Setup (2026-08-15) -- a client
 * component (like bplo/assessment-line-items.tsx's AssessmentLineItems) because this genuinely needs
 * multi-step interaction: pick a file, see a plain-language preview of
 * what it will do, then explicitly confirm before anything touches live
 * rates. Nothing here writes to the database directly -- both
 * previewFeeRuleImport and publishFeeRuleImport re-parse the file
 * server-side (see actions.ts), this component only ever displays what
 * those calls returned.
 */
export function FeeRuleImportCard({ feeType, label }: { feeType: FeeType; label: string }) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStage({ kind: "reading" });
    const csvText = await file.text();
    const result = await previewFeeRuleImport(feeType, csvText);
    if (!result.ok) {
      setStage({ kind: "error", errors: result.errors });
      return;
    }
    setStage({ kind: "previewed", csvText, fileName: file.name, preview: result });
  }

  async function handlePublish() {
    if (stage.kind !== "previewed") return;
    setStage({ kind: "publishing" });
    const result = await publishFeeRuleImport(feeType, stage.csvText);
    if (!result.ok) {
      setStage({ kind: "error", errors: result.errors });
      return;
    }
    setStage({ kind: "published", ruleCount: result.ruleCount });
  }

  function reset() {
    setStage({ kind: "idle" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13.5px] font-bold text-ink">{label}</p>
          <p className="text-[12px] text-ink-soft">Download the current rates as a starting point, edit the numbers in Excel/Sheets, then upload it back here.</p>
        </div>
        <a
          href={`/api/dashboard/fee-rule-template?type=${feeType}`}
          className="rounded-xl border border-border-strong px-3 py-2 text-[12.5px] font-bold text-ink-soft hover:bg-surface-2"
        >
          Download template (CSV)
        </a>
      </div>

      {stage.kind === "idle" || stage.kind === "reading" ? (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-border-strong bg-surface-2 px-4 py-6 text-center hover:bg-surface-3">
          <span className="text-[13px] font-bold text-ink">{stage.kind === "reading" ? "Reading file..." : "Click to choose a CSV file"}</span>
          <span className="text-[11.5px] text-ink-faint">Must be the same column format as the downloaded template.</span>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} disabled={stage.kind === "reading"} />
        </label>
      ) : null}

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
          <div className="mb-2 flex items-center gap-2">
            <TonePill label={`${stage.preview.ruleCount} rule${stage.preview.ruleCount === 1 ? "" : "s"} found`} tone="info" />
            <span className="text-[12px] font-bold text-ink-soft">from {stage.fileName}</span>
          </div>
          <p className="mb-1.5 text-[12.5px] font-bold text-info-ink">Review before this goes live -- once published, these replace the current active rates for new assessments:</p>
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
            <PrimaryButton onClick={handlePublish}>Looks right -- publish</PrimaryButton>
            <MiniButton tone="neutral" onClick={reset}>
              Cancel
            </MiniButton>
          </div>
        </div>
      )}

      {stage.kind === "publishing" && <p className="text-[13px] font-bold text-ink-soft">Publishing...</p>}

      {stage.kind === "published" && (
        <div className="rounded-2xl border border-good bg-good-bg p-4">
          <p className="text-[13px] font-bold text-good-ink">
            Published {stage.ruleCount} rule{stage.ruleCount === 1 ? "" : "s"} -- every new assessment now uses these rates.
          </p>
          <MiniButton tone="neutral" className="mt-2" onClick={reset}>
            Upload another file
          </MiniButton>
        </div>
      )}
    </Card>
  );
}
