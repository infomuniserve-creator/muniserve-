"use client";

import { useRef, useState } from "react";
import { MiniButton } from "../ui";
import { removeLguLogo, updateLguLogo } from "./logo-actions";

type Stage = { kind: "idle" } | { kind: "uploading" } | { kind: "error"; message: string };

/**
 * "LGU Logo" (2026-08-21, CLAUDE.md) -- shown in the header of every
 * applicant-facing email. A single-file upload with no multi-step preview
 * (unlike PrintTemplateUpload's field-mapping flow) -- there's nothing to
 * configure beyond the image itself, so choosing a file uploads it right
 * away.
 */
export function LogoUpload({ logoUrl, lguName }: { logoUrl: string | null; lguName: string }) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [preview, setPreview] = useState<string | null>(logoUrl);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStage({ kind: "uploading" });
    const formData = new FormData();
    formData.set("file", file);
    const result = await updateLguLogo(formData);
    if (!result.ok) {
      setStage({ kind: "error", message: result.error });
      return;
    }
    setPreview(result.logoUrl);
    setStage({ kind: "idle" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleRemove() {
    await removeLguLogo();
    setPreview(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4 rounded-xl border-2 border-dashed border-border-strong bg-surface-2 p-4">
        <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- an external Supabase Storage URL, not a local/optimizable asset
            <img src={preview} alt={`${lguName} logo`} className="size-full object-cover" />
          ) : (
            <span className="text-center text-[10.5px] font-bold leading-tight text-ink-faint">No logo yet</span>
          )}
        </div>
        <p className="min-w-0 flex-1 text-[12.5px] text-ink-soft">
          {preview
            ? "Shown in the header of every email sent to applicants."
            : "Upload a square image for the best fit — it's placed inside a circle."}
        </p>
      </div>

      {stage.kind === "error" && <p className="text-[12.5px] font-bold text-bad-ink">{stage.message}</p>}

      <div className="flex flex-wrap gap-2">
        <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-border-strong bg-surface-2 px-4 py-3 text-[12.5px] font-bold text-ink hover:bg-surface-3">
          {stage.kind === "uploading" ? "Uploading..." : preview ? "Replace logo" : "Upload logo"}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleFileChange}
            disabled={stage.kind === "uploading"}
          />
        </label>
        {preview && (
          <MiniButton tone="bad" onClick={handleRemove}>
            Remove
          </MiniButton>
        )}
      </div>
    </div>
  );
}
