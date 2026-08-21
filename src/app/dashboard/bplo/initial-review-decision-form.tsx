"use client";

import { useState } from "react";
import { DecisionButtons, guardNotesRequired, NotesField } from "../ui";
import { submitInitialReview } from "./actions";

/**
 * Extracted out of InitialReviewCard (a big async Server Component) into
 * its own small client component (2026-08-21) -- the notes-required
 * guard needs real client-side state (guardNotesRequired's onSubmit
 * check + the resulting error message), the same reason
 * DepartmentReviewActions is a client component for the identical
 * decision-buttons-plus-notes shape. See NOTES_REQUIRED_DECISIONS'
 * comment (ui.tsx) for why this exists: a hint that only *looked*
 * required was never actually enforced anywhere, client or server.
 */
export function InitialReviewDecisionForm({ applicationId, disableApprove }: { applicationId: string; disableApprove: boolean }) {
  const [notesError, setNotesError] = useState<string | null>(null);

  return (
    <form action={submitInitialReview} onSubmit={(e) => setNotesError(guardNotesRequired(e))}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <NotesField
        id={`notes-${applicationId}`}
        name="notes"
        placeholder="Notes"
        hint="Required if requesting info, approving with a condition, or rejecting."
        error={notesError ?? undefined}
        aria-label="Review notes"
      />
      <DecisionButtons disableApprove={disableApprove} />
    </form>
  );
}
