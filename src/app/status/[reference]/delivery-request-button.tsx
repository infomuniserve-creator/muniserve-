"use client";

import { useState } from "react";

/**
 * Delivery Service (2026-08-22, project owner's own idea): the one button
 * an applicant sees on their status page once their permit reaches
 * pending_release and the LGU has turned this on (request-delivery/
 * route.ts). Ignoring this entirely is a valid, expected choice -- it
 * just means they'll pick it up themselves, same as before this feature
 * existed, so there's no pressure copy here, just a plain option.
 */
export function DeliveryRequestButton({ applicationId }: { applicationId: string }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestDelivery() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/applicant/request-delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId }),
      });
      if (!res.ok) {
        setError("Could not request delivery right now — try again in a moment, or just pick it up at the BPLO office.");
        return;
      }
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return <p style={{ fontSize: 12, color: "#27500A", marginTop: 6 }}>Delivery requested — the courier has been notified and will pick it up on your behalf.</p>;
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={requestDelivery}
        disabled={loading}
        style={{ fontSize: 13, padding: "10px 16px", minHeight: 44, borderRadius: 8, border: "none", background: "#0C447C", color: "#fff", fontWeight: 600, cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1 }}
      >
        {loading ? "Requesting…" : "Request delivery instead"}
      </button>
      {error && <p style={{ fontSize: 11, color: "#791F1F", marginTop: 6 }}>{error}</p>}
    </div>
  );
}
