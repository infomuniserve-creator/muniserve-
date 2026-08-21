"use client";

import { useState } from "react";
import { DecisionButtons, guardNotesRequired, NotesField } from "./ui";

/**
 * The decision form every department-review surface uses -- the
 * department's own dashboard (full) and BPLO's "act on a department's
 * behalf" inline row (compact). Extracted into one shared client
 * component (2026-08-15, CLAUDE.md 7aa) specifically because
 * Engineering's Building Permit Fee amount field needs to react to live
 * typing -- Approve/Approve-with-condition go inert until a value is
 * entered, the same reasoning AssessmentLineItems (bplo/assessment-
 * line-items.tsx) is a client component ("the one piece that needed real
 * interactivity"). Every other department's review still renders exactly
 * as before; the amount field only appears at all when
 * department === "Engineering" and the LGU has the fee turned on.
 *
 * Notes are now ALWAYS rendered, compact or not (2026-08-21, real audit
 * finding closed for real) -- the compact/on-behalf row previously had
 * no `showNotes` prop passed at all, meaning BPLO acting on a department's
 * behalf could reject or request more info with literally no way to
 * explain why, on top of nothing anywhere actually requiring one. Both
 * gaps are closed together: a note is always possible, and is required
 * client- and server-side for the same three decisions everywhere.
 */
export function DepartmentReviewActions({
  action,
  departmentReviewId,
  department,
  buildingPermitFeeEnabled,
  buildingPermitFeeLabel,
  compact,
}: {
  action: (formData: FormData) => void;
  departmentReviewId: string;
  department: string;
  buildingPermitFeeEnabled: boolean;
  buildingPermitFeeLabel: string;
  compact?: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [notesError, setNotesError] = useState<string | null>(null);
  const needsAmount = buildingPermitFeeEnabled && department === "Engineering";
  const amountMissing = needsAmount && (!amount || Number(amount) <= 0);

  return (
    <form action={action} onSubmit={(e) => setNotesError(guardNotesRequired(e))} className={compact ? "mb-1.5 w-full" : undefined}>
      <input type="hidden" name="departmentReviewId" value={departmentReviewId} />
      <NotesField
        id={`notes-${departmentReviewId}`}
        name="notes"
        placeholder="Notes"
        hint="Required if requesting info, approving with a condition, or rejecting."
        error={notesError ?? undefined}
        aria-label="Review notes"
        className={compact ? "min-h-[36px] text-[12px]" : undefined}
      />
      <div className={compact ? "flex flex-wrap items-center gap-1.5" : undefined}>
        {needsAmount && (
          <div className={compact ? "flex items-center gap-1.5" : "mb-3 flex items-center gap-2"}>
            <label className="text-[11px] font-bold text-ink-soft">{buildingPermitFeeLabel}:</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              name="assessedAmount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="₱ amount"
              className="h-8 w-28 rounded-lg border border-border-strong bg-surface px-2 text-[12px] text-ink placeholder:text-ink-faint"
            />
          </div>
        )}
        <DecisionButtons compact={compact} disableApprove={amountMissing} />
      </div>
    </form>
  );
}
