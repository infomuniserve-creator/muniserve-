"use client";

import { useState } from "react";
import { peso } from "../ui";
import type { FeeLineResult } from "@/lib/fee-engine";
import type { ManualFieldSpec } from "./assessment-manual-fields";

/**
 * The interactive half of the assessment card (2026-08-16 follow-up,
 * flagged live by the project owner): BPLO could type an override amount
 * and a reason, but the displayed "Total due online" never reflected it
 * until the whole form was already submitted via "Finalize assessment" --
 * a real, one-shot action with no way to check the resulting number
 * first.
 *
 * The override inputs are unchanged in behavior -- same
 * `name="override_<feeRuleId>"` / `name="overrideReason_<feeRuleId>"`
 * fields `finalizeAssessment` (bplo/actions.ts) already reads, submitted
 * with whatever's currently typed at the moment "Finalize assessment" is
 * clicked, regardless of whether "Save" was ever pressed. Save is purely
 * a client-side preview affordance -- it decides what counts toward the
 * LIVE total shown here, nothing about what finalizeAssessment itself
 * receives, so the preview and the real submission can never disagree
 * about what "the form's actual values" means. No server-side change
 * needed for this at all.
 *
 * Clearing an override field back to blank reverts the live total
 * immediately, no Save needed -- a blank override is already unambiguous
 * (finalizeAssessment's own logic already treats "" as "no override"),
 * so there's nothing to confirm. A non-blank draft only counts toward
 * the preview once Saved, so the total doesn't flicker mid-keystroke
 * while typing a multi-digit amount.
 *
 * Folds in the manual-entry fields too (formerly a separate
 * AssessmentManualSection instance, now rendered from here) so overrides
 * and manual entries combine into one live total instead of two
 * components each unaware of the other's contribution.
 */
export function AssessmentLineItems({
  lines, warnings, automatedAssessmentEnabled, manualFields,
}: {
  lines: FeeLineResult[];
  warnings: string[];
  automatedAssessmentEnabled: boolean;
  manualFields: ManualFieldSpec[];
}) {
  const [overrideDraft, setOverrideDraft] = useState<Record<string, string>>({});
  const [overrideApplied, setOverrideApplied] = useState<Record<string, string>>({});
  const [manualValues, setManualValues] = useState<Record<string, string>>(
    Object.fromEntries(manualFields.map((f) => [f.key, f.initial != null ? String(f.initial) : ""]))
  );

  function setDraft(id: string, value: string) {
    setOverrideDraft((d) => ({ ...d, [id]: value }));
    if (value.trim() === "") {
      setOverrideApplied((a) => ({ ...a, [id]: "" }));
    }
  }

  function saveOverride(id: string) {
    setOverrideApplied((a) => ({ ...a, [id]: overrideDraft[id] ?? "" }));
  }

  const computedTotal = lines
    .filter((l) => l.includedInTotal)
    .reduce((sum, l) => {
      const applied = l.feeRuleId ? overrideApplied[l.feeRuleId] : undefined;
      const n = applied ? Number(applied) : NaN;
      return sum + (applied && Number.isFinite(n) ? n : l.amount);
    }, 0);

  const manualSum = automatedAssessmentEnabled
    ? 0
    : Object.values(manualValues).reduce((sum, v) => {
        const n = Number(v);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);

  return (
    <>
      <div className="mb-3 divide-y divide-border rounded-2xl border border-border">
        {lines.map((line) => {
          const id = line.feeRuleId;
          const draft = id ? (overrideDraft[id] ?? "") : "";
          const applied = id ? (overrideApplied[id] ?? "") : "";
          const hasUnsavedDraft = draft.trim() !== "" && draft !== applied;
          const isApplied = applied.trim() !== "";
          return (
            <div key={id ?? line.feeCategory} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-bold text-ink">{line.displayLabel}</p>
                {!line.includedInTotal && <p className="text-[11px] text-ink-faint">Paid at a physical counter — not part of the online total.</p>}
                {line.note && <p className="text-[11px] text-warn-ink">{line.note}</p>}
                {isApplied && <p className="text-[11px] font-bold text-good">✓ Override applied to the total below.</p>}
              </div>
              <span className="font-display text-[15px] font-bold tabular-nums text-brand-navy">{peso(line.amount)}</span>
              {id && (
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
                  <input
                    type="number"
                    step="0.01"
                    name={`override_${id}`}
                    value={draft}
                    onChange={(e) => setDraft(id, e.target.value)}
                    placeholder="Override (₱)"
                    aria-label={`Override amount for ${line.displayLabel}`}
                    className="h-8 w-28 rounded-lg border border-border-strong bg-surface px-2 text-[12px] text-ink placeholder:text-ink-faint"
                  />
                  <input
                    type="text"
                    name={`overrideReason_${id}`}
                    placeholder="Reason for override"
                    aria-label={`Reason for overriding ${line.displayLabel}`}
                    className="h-8 flex-1 rounded-lg border border-border-strong bg-surface px-2 text-[12px] text-ink placeholder:text-ink-faint"
                  />
                  <button
                    type="button"
                    onClick={() => saveOverride(id)}
                    disabled={!hasUnsavedDraft}
                    className="h-8 shrink-0 rounded-lg border border-brand-teal px-3 text-[12px] font-bold text-brand-teal transition-colors hover:bg-good-bg disabled:cursor-not-allowed disabled:border-border disabled:text-ink-faint disabled:hover:bg-transparent"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {warnings.length > 0 && (
        <div className="mb-3 flex flex-col gap-1 rounded-2xl bg-info-bg px-4 py-3 text-[12px] font-bold text-info-ink">
          {warnings.map((w, i) => <span key={i}>{w}</span>)}
        </div>
      )}

      {!automatedAssessmentEnabled && manualFields.length > 0 && (
        <div className="mb-3 divide-y divide-border rounded-2xl border border-warn">
          {manualFields.map((f) => (
            <div key={f.key} className="flex flex-wrap items-center gap-2 bg-warn-bg px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-bold text-ink">{f.label}</p>
                <p className="text-[11px] font-bold text-warn-ink">Automated Assessment is off — enter this amount manually.</p>
                {f.note && <p className="text-[11px] text-ink-faint">{f.note}</p>}
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                name={f.key}
                required
                value={manualValues[f.key]}
                onChange={(e) => setManualValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder="₱ amount"
                aria-label={`Amount for ${f.label}`}
                className="h-9 w-32 rounded-lg border border-warn bg-surface px-2 text-[13px] font-bold text-ink placeholder:text-ink-faint"
              />
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3">
        <span className="text-[12.5px] font-bold text-ink-soft">Total due online</span>
        <span className="font-display text-[20px] font-bold tabular-nums text-ink">{peso(computedTotal + manualSum)}</span>
      </div>
    </>
  );
}
