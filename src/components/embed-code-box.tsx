"use client";

import { useState } from "react";

/**
 * A read-only code snippet with a copy button (CLAUDE.md 7o follow-up) --
 * used on both /dashboard/staff (Tailwind-styled) and /admin (plain inline
 * styles), so this is deliberately self-contained with its own inline
 * styles rather than the dashboard's ui.tsx component library, matching
 * how apply/login/status/verify/admin already share plain-styled pieces
 * across differently-styled route segments.
 *
 * navigator.clipboard.writeText() can fail (no HTTPS, permissions denied,
 * older browsers) -- the textarea itself stays manually selectable
 * (select-on-focus) as a fallback either way, so copying never actually
 * depends on the button working.
 */
export function EmbedCodeBox({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable/denied -- the textarea below is still
      // selectable by hand, so this silently does nothing rather than
      // showing an error for a non-essential convenience feature.
    }
  }

  return (
    <div>
      <textarea
        readOnly
        value={code}
        onFocus={(e) => e.currentTarget.select()}
        rows={4}
        style={{
          width: "100%",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 11.5,
          padding: 10,
          borderRadius: 8,
          border: "0.5px solid #e5e7eb",
          background: "#f4f6fb",
          color: "#1a1a2e",
          resize: "vertical",
        }}
      />
      <button
        type="button"
        onClick={copy}
        style={{
          marginTop: 8,
          fontSize: 12,
          fontWeight: 600,
          padding: "6px 14px",
          borderRadius: 8,
          border: "1px solid #0C447C",
          background: copied ? "#0C447C" : "#fff",
          color: copied ? "#fff" : "#0C447C",
          cursor: "pointer",
        }}
      >
        {copied ? "Copied!" : "Copy embed code"}
      </button>
    </div>
  );
}
