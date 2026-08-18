"use client";

import { useState } from "react";
import { signOutApplicant } from "@/lib/applicant-session-actions";

/**
 * The authenticated status view had no way to end the session at all --
 * on a shared/public device, whoever's applicant_session cookie happens to
 * be active stays signed in for the full 30 days with no visible "not you?"
 * escape hatch here (unlike the apply flow's own "Start over", also fixed
 * the same day to actually revoke rather than just reset local state).
 */
export function SignOutButton() {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    await signOutApplicant();
    window.location.reload();
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{ fontSize: 11, color: "#6b7280", background: "none", border: "none", padding: 0, marginBottom: 12, display: "block", cursor: "pointer", textDecoration: "underline" }}
    >
      {loading ? "Signing out…" : "Not you? Sign out"}
    </button>
  );
}
