"use client";

import { useState } from "react";
import { peso } from "../ui";

export type ManualFieldSpec = {
  key: string; // matches the form field name finalizeAssessment reads (manual_lbt / manual_mayors_permit / manual_regulatory_<feeRuleId>)
  label: string;
  initial: number | null; // the engine's own computed value, if it found one -- a starting point BPLO can accept or overwrite, not a guess presented as final
  note?: string;
};

/**
 * The manual-entry half of the assessment card, when Automated Assessment
 * is off (2026-08-14 follow-up -- lgus.automated_assessment_enabled). A
 * client component specifically because the project owner asked for the
 * total to update live as BPLO types ("the system should automatically
 * calculate the total on the bottom") -- everything else on this card
 * stays a plain server-rendered form, this is the one piece that actually
 * needs to react to input as it happens.
 *
 * `computedTotal` is the sum of every line that stayed automatic (flat
 * regulatory fees, CEDULA doesn't count since it's reference_only) --
 * fixed, computed server-side, passed in once. This component only ever
 * adds the manual fields' current values on top of it.
 */
export function AssessmentManualSection({ computedTotal, manualFields }: { computedTotal: number; manualFields: ManualFieldSpec[] }) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(manualFields.map((f) => [f.key, f.initial != null ? String(f.initial) : ""]))
  );

  const manualSum = Object.values(values).reduce((sum, v) => {
    const n = Number(v);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  return (
    <>
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
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder="₱ amount"
              className="h-9 w-32 rounded-lg border border-warn bg-surface px-2 text-[13px] font-bold text-ink placeholder:text-ink-faint"
            />
          </div>
        ))}
      </div>

      <div className="mb-4 flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3">
        <span className="text-[12.5px] font-bold text-ink-soft">Total due online</span>
        <span className="font-display text-[20px] font-bold tabular-nums text-ink">{peso(computedTotal + manualSum)}</span>
      </div>
    </>
  );
}
