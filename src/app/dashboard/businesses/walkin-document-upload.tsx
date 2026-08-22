"use client";

import { useState } from "react";
import { ALLOWED_TYPES, DOCUMENT_BUCKET, MAX_FILE_BYTES, MAX_FILE_MB } from "@/lib/document-upload";
import { createClient } from "@/lib/supabase/client";

type StagedDoc = { path: string; fileName: string; documentType: string };

/**
 * "Upload requirements" on the walk-in form (2026-08-22) -- closes the gap
 * flagged directly by the project owner: a walk-in renewal/new-permit
 * filing skips pending_bplo_initial entirely (businesses/actions.ts's
 * startWalkInApplication, section 7e) and opens the department round right
 * away with zero digitized documents -- BPLO looked at the physical copies
 * at the counter, but Engineering/MHO/MPDO/BFP/MENRO had nothing to review
 * on their own end. This lets BPLO attach a scan (if the counter's own
 * scanner writes to a folder on the PC) or a phone photo (via `capture`,
 * which opens the camera directly on a mobile browser) right here, before
 * submitting.
 *
 * Deliberately one step, not the applicant-side upload flow's own
 * upload-then-Send pause (status/[reference]/upload-form.tsx) -- there's
 * no separate "send" moment here, since the one real commit is the walk-in
 * form's own submit. Files upload straight to Storage as soon as they're
 * picked (via request-walkin-upload-url/route.ts, the same direct-to-
 * Storage technique as every other upload in this app, so a real scanned
 * multi-page PDF isn't capped by Vercel's own function body limit); the
 * resulting {path, documentType} list rides along as a hidden JSON input
 * inside the surrounding <form>, and startWalkInApplication only turns
 * them into real `documents` rows once the whole form is actually
 * submitted. A file picked here but the form never submitted is cleaned
 * up automatically by the existing orphaned-upload cron, same as every
 * other staged-but-abandoned upload in this app -- no separate cleanup.
 */
export function WalkInDocumentUpload() {
  const [docs, setDocs] = useState<StagedDoc[]>([]);
  const [documentType, setDocumentType] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!documentType.trim()) {
      setError("Describe what this document is first.");
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

    setUploading(true);
    try {
      const urlRes = await fetch("/api/dashboard/request-walkin-upload-url", {
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

      setDocs((prev) => [...prev, { path, fileName: file.name, documentType: documentType.trim() }]);
      setDocumentType("");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-xl border border-border-strong bg-surface p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">Requirements (optional)</p>

      {docs.length > 0 && (
        <ul className="flex flex-col gap-1">
          {docs.map((d, i) => (
            <li key={d.path} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink">
              <span><span className="font-bold">{d.documentType}</span> — {d.fileName}</span>
              <button
                type="button"
                onClick={() => setDocs((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-[11px] font-bold text-ink-faint hover:text-bad-ink"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value)}
          placeholder="What is this document? (e.g. DTI, Barangay Clearance)"
          className="h-9 min-w-[220px] flex-1 rounded-xl border border-border-strong bg-surface px-3 text-[12.5px] text-ink placeholder:text-ink-faint"
        />
        <label className="flex h-9 shrink-0 cursor-pointer items-center rounded-xl border border-border-strong bg-surface-2 px-3 text-[12.5px] font-bold text-ink">
          {uploading ? "Uploading…" : "Scan / upload file"}
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            capture="environment"
            disabled={uploading}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) handleFile(f);
            }}
          />
        </label>
      </div>
      {error && <p className="text-[11px] text-bad-ink">{error}</p>}

      <input type="hidden" name="walkinDocuments" value={JSON.stringify(docs.map(({ path, documentType }) => ({ path, documentType })))} />
    </div>
  );
}
