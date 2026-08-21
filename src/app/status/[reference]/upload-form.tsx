"use client";

import { useState } from "react";
import { ALLOWED_TYPES, DOCUMENT_BUCKET, MAX_FILE_BYTES, MAX_FILE_MB } from "@/lib/document-upload";
import { createClient } from "@/lib/supabase/client";

/**
 * Lets the applicant attach an additional document to their already-
 * submitted application (CLAUDE.md section 7c -- the BFP payment-proof
 * screenshot is the motivating case). Uploads straight to Supabase
 * Storage via a signed URL (2026-08-17) rather than through our own
 * server -- a real scanned government document routinely exceeds Vercel's
 * ~4.5MB function request-body ceiling, which routing the file through
 * upload-additional-document/route.ts directly was always going to hit
 * regardless of what size limit that route declared.
 *
 * Two real, separate steps, not one auto-chained action (2026-08-21,
 * project owner's own direct report): choosing a file used to upload it
 * to Storage AND immediately register/notify staff in one uninterrupted
 * sequence, so by the time "Uploaded" appeared, it had already been sent
 * -- not the "pick a file, see it succeeded, then decide to send" flow
 * people actually expect. The upload itself (request-upload-url + the
 * direct PUT to Storage) and the register call (upload-additional-
 * document/route.ts -- this is what actually links it to the
 * application and fires resolveOpenInfoRequests/staff notifications)
 * were already two separate network calls under the hood; this only
 * changes the UI to pause between them with a real confirmation and an
 * explicit "Send" action, instead of firing the second the instant the
 * first succeeds. A file staged here but never sent is cleaned up
 * automatically by the existing orphaned-upload cron (CLAUDE.md, the
 * cleanup-orphaned-uploads job) -- no separate cleanup needed for
 * someone who uploads then navigates away without sending.
 */
export function AdditionalDocumentUpload({ applicationId, defaultLabel }: { applicationId: string; defaultLabel: string }) {
  const [documentType, setDocumentType] = useState(defaultLabel);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [staged, setStaged] = useState<{ path: string; fileName: string } | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      if (!documentType.trim()) {
        setError("Please describe what this document is before uploading.");
        return;
      }
      if (!ALLOWED_TYPES.includes(file.type)) {
        setError("Please upload a PDF or image (JPG, PNG, or WEBP).");
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError(`That file is too large (${MAX_FILE_MB}MB max).`);
        return;
      }

      const urlRes = await fetch("/api/applicant/request-upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type, fileName: file.name }),
      });
      if (!urlRes.ok) {
        setError("Could not start that upload. Try again in a moment.");
        return;
      }
      const { path, token } = await urlRes.json();

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (uploadError) {
        setError("Could not upload that file. Check your connection and try again.");
        return;
      }

      // Upload itself succeeded -- stop here and let the applicant
      // actually see that before it goes anywhere. Registering (the
      // network call that links this to the application and notifies
      // staff) only happens once they click Send below.
      setStaged({ path, fileName: file.name });
    } finally {
      setUploading(false);
    }
  }

  async function handleSend() {
    if (!staged) return;
    if (!documentType.trim()) {
      setError("Please describe what this document is before sending.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const registerRes = await fetch("/api/applicant/upload-additional-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: staged.path, documentType, applicationId }),
      });
      if (!registerRes.ok) {
        setError("Could not send that upload. Try again.");
        return;
      }
      setDone(true);
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return <p style={{ fontSize: 12, color: "#27500A" }}>Sent. Staff will see this on your application.</p>;
  }

  return (
    <div style={{ marginTop: 8 }}>
      <input
        value={documentType}
        onChange={(e) => setDocumentType(e.target.value)}
        placeholder="What is this document?"
        disabled={!!staged}
        style={{ width: "100%", height: 32, border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "0 10px", fontSize: 12, marginBottom: 6 }}
      />

      {staged ? (
        <>
          <p style={{ fontSize: 12, color: "#27500A", marginBottom: 6 }}>Upload successful: {staged.fileName}</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending}
              style={{ fontSize: 12, padding: "6px 14px", borderRadius: 8, border: "none", background: "#0C447C", color: "#fff", fontWeight: 600, cursor: sending ? "default" : "pointer", opacity: sending ? 0.7 : 1 }}
            >
              {sending ? "Sending…" : "Send"}
            </button>
            <button
              type="button"
              onClick={() => { setStaged(null); setError(null); }}
              disabled={sending}
              style={{ fontSize: 12, padding: "6px 14px", borderRadius: 8, border: "0.5px solid #e5e7eb", background: "#fff", cursor: sending ? "default" : "pointer" }}
            >
              Choose a different file
            </button>
          </div>
        </>
      ) : (
        <label style={{ fontSize: 12, padding: "6px 10px", borderRadius: 8, border: "0.5px solid #e5e7eb", background: "#fff", cursor: "pointer", display: "inline-block" }}>
          {uploading ? "Uploading…" : "Choose file"}
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </label>
      )}
      {error && <p style={{ fontSize: 11, color: "#791F1F", marginTop: 6 }}>{error}</p>}
    </div>
  );
}
