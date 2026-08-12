"use client";

import { useState } from "react";

/** Lets the applicant attach an additional document to their already-submitted application (CLAUDE.md section 7c -- the BFP payment-proof screenshot is the motivating case). */
export function AdditionalDocumentUpload({ applicationId, defaultLabel }: { applicationId: string; defaultLabel: string }) {
  const [documentType, setDocumentType] = useState(defaultLabel);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("documentType", documentType);
      fd.append("applicationId", applicationId);
      const res = await fetch("/api/applicant/upload-additional-document", { method: "POST", body: fd });
      if (!res.ok) {
        setError("Could not upload that file. Try a PDF or image under 10MB.");
        return;
      }
      setDone(true);
    } finally {
      setUploading(false);
    }
  }

  if (done) {
    return <p style={{ fontSize: 12, color: "#27500A" }}>Uploaded. Staff will see this on your application.</p>;
  }

  return (
    <div style={{ marginTop: 8 }}>
      <input
        value={documentType}
        onChange={(e) => setDocumentType(e.target.value)}
        placeholder="What is this document?"
        style={{ width: "100%", height: 32, border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "0 10px", fontSize: 12, marginBottom: 6 }}
      />
      <label style={{ fontSize: 12, padding: "6px 10px", borderRadius: 8, border: "0.5px solid #e5e7eb", background: "#fff", cursor: "pointer", display: "inline-block" }}>
        {uploading ? "Uploading…" : "Choose file"}
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </label>
      {error && <p style={{ fontSize: 11, color: "#791F1F", marginTop: 6 }}>{error}</p>}
    </div>
  );
}
