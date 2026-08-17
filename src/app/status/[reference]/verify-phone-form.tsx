"use client";

import { useState } from "react";

/**
 * Re-verification for the "different browser/device" case -- the
 * applicant_session cookie only ever exists in the one browser that
 * submitted this application (applicant-session.ts), so a "request more
 * info" email/SMS link opened elsewhere (e.g. checking email on a phone)
 * hits a dead end otherwise. Lets the real owner prove it by receiving an
 * OTP on the phone actually on file, instead of being told to go find
 * their original browser. Mirrors the renewal OTP flow (apply page),
 * scoped down to just send + verify, since the owner already exists here.
 */
export function VerifyPhoneCard({ applicationId, maskedPhone }: { applicationId: string; maskedPhone: string }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/applicant/send-status-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.error === "too_soon"
            ? "Please wait a bit before requesting another code."
            : "Could not send a code right now — try again in a moment."
        );
        return;
      }
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/applicant/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, code: code.trim() }),
      });
      if (!res.ok) {
        setError("That code didn't work — check it and try again, or request a new one.");
        return;
      }
      window.location.reload();
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = { width: "100%", height: 34, border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "0 10px", fontSize: 13, marginBottom: 8 } as const;
  const btnStyle = { fontSize: 12, padding: "6px 10px", borderRadius: 8, border: "0.5px solid #e5e7eb", background: "#0C447C", color: "#fff", fontWeight: 600, cursor: "pointer" } as const;
  const ghostBtnStyle = { ...btnStyle, background: "#fff", color: "#0C447C" } as const;

  if (!sent) {
    return (
      <div style={{ marginTop: 10 }}>
        <button onClick={sendCode} disabled={loading} style={btnStyle}>
          {loading ? "Sending…" : `Text a code to ${maskedPhone}`}
        </button>
        {error && <p style={{ fontSize: 11, color: "#791F1F", marginTop: 6 }}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>We sent a 6-digit code to {maskedPhone}.</p>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="6-digit code"
        style={inputStyle}
      />
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={verify} disabled={loading || code.trim().length !== 6} style={btnStyle}>
          {loading ? "Verifying…" : "Verify"}
        </button>
        <button onClick={sendCode} disabled={loading} style={ghostBtnStyle}>
          Resend
        </button>
      </div>
      {error && <p style={{ fontSize: 11, color: "#791F1F", marginTop: 6 }}>{error}</p>}
    </div>
  );
}
