"use client";

import { useState } from "react";
import { Card, PrimaryButton } from "../ui";
import { updatePermitNumberFormat } from "./actions";

type Props = {
  prefix: string;
  yearDigits: 2 | 4;
  counterDigits: number;
};

/**
 * Permit No. Format (2026-08-19) -- three fields in a row, matching the
 * project owner's own description of how LGUs actually format this
 * (e.g. "SMB - 2026 - 000056"). Prefix and counter width accept any
 * length the LGU wants; the year always stays live-computed from the
 * real calendar date (confirmed with the project owner) -- this form
 * only lets them pick 2 vs. 4 digits of it, never freezes it as static
 * text, so nobody has to remember to update Settings every January.
 *
 * Only made a client component for the live preview string as the LGU
 * types -- the actual submit still goes through a plain server-action
 * form, same shape as every other Settings card. See actions.ts's
 * updatePermitNumberFormat for the real validation (this component's own
 * checks are just for the live preview / disabling Save early, not
 * authoritative).
 */
export function PermitNumberFormatCard({ prefix, yearDigits, counterDigits }: Props) {
  const [draftPrefix, setDraftPrefix] = useState(prefix);
  const [draftYearDigits, setDraftYearDigits] = useState<2 | 4>(yearDigits);
  const [draftCounterDigits, setDraftCounterDigits] = useState(counterDigits);

  const cleanPrefix = draftPrefix.trim().toUpperCase() || "APP";
  const sampleYear = draftYearDigits === 2 ? "26" : "2026";
  const sampleCounter = "1".padStart(Math.min(Math.max(draftCounterDigits, 1), 8), "0");
  const preview = `${cleanPrefix}-${sampleYear}-${sampleCounter}`;

  const prefixValid = /^[A-Z0-9]{1,8}$/.test(draftPrefix.trim().toUpperCase());
  const counterValid = Number.isInteger(draftCounterDigits) && draftCounterDigits >= 3 && draftCounterDigits <= 8;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <form action={updatePermitNumberFormat} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-bold text-ink-soft">Prefix</span>
          <input
            name="prefix"
            type="text"
            required
            maxLength={8}
            value={draftPrefix}
            onChange={(e) => setDraftPrefix(e.target.value)}
            placeholder="e.g. SMB"
            className="h-9 w-28 rounded-xl border border-border-strong bg-surface px-3 text-[13px] font-bold uppercase text-ink placeholder:text-ink-faint placeholder:normal-case"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-bold text-ink-soft">Year</span>
          <select
            name="yearDigits"
            value={draftYearDigits}
            onChange={(e) => setDraftYearDigits(Number(e.target.value) === 2 ? 2 : 4)}
            className="h-9 rounded-xl border border-border-strong bg-surface px-2.5 text-[13px] text-ink"
          >
            <option value={4}>4 digits (2026)</option>
            <option value={2}>2 digits (26)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-bold text-ink-soft">Auto-incrementing number</span>
          <select
            name="counterDigits"
            value={draftCounterDigits}
            onChange={(e) => setDraftCounterDigits(Number(e.target.value))}
            className="h-9 rounded-xl border border-border-strong bg-surface px-2.5 text-[13px] text-ink"
          >
            {[3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n} digits ({"0".repeat(n - 1)}1)
              </option>
            ))}
          </select>
        </label>
        <PrimaryButton type="submit" disabled={!prefixValid || !counterValid}>
          Save
        </PrimaryButton>
      </form>

      <div className="rounded-2xl bg-surface-2 px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">Preview of the next permit number</p>
        <p className="mt-1 font-display text-[18px] font-bold tabular-nums text-ink">{preview}</p>
        <p className="mt-1 text-[11.5px] text-ink-soft">
          The year always updates automatically on its own every January -- only how many digits of it show is a choice. The last field is the one that counts up automatically per application, resetting to 1 every new year.
        </p>
      </div>
    </Card>
  );
}
