import type { LguDisplay } from "@/lib/lgu";

/**
 * Shown instead of the whole application wizard when this LGU is paused
 * (CLAUDE.md 7o follow-up, migration 0020). Deliberately different copy
 * from dashboard/paused-notice.tsx's staff-facing version -- that one
 * says "contact your administrator" because it's about the LGU's own
 * relationship with MuniServe (e.g. unpaid invoice), which isn't
 * something to expose to an applicant. An applicant just needs to know
 * the online service isn't available right now and where to go instead;
 * hello@muniserve.ph/the pause reason are platform-internal, not theirs
 * to see or act on.
 */
export function ApplyPausedNotice({ lgu }: { lgu: LguDisplay }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#f4f6fb" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 40, maxWidth: 420, width: "100%", textAlign: "center", border: "1px solid #c7ced8" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🛠️</div>
        {/* Sentence case, matching every other heading on these pages (2026-08-20 audit finding -- this was the one holdout still in Title Case). */}
        <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Applications temporarily unavailable</h1>
        <p style={{ fontSize: 13.5, color: "#6b7280", lineHeight: 1.6 }}>
          Online business permit applications for <strong>{lgu.name}{lgu.province ? `, ${lgu.province}` : ""}</strong> are
          temporarily unavailable. Please visit the {lgu.bploOfficeName} in person, or check back later.
        </p>
      </div>
    </div>
  );
}
