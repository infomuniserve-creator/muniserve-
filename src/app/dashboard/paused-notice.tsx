import { SignOutButton } from "./sign-out-button";

/**
 * Shown instead of the entire dashboard shell (dashboard/layout.tsx never
 * renders {children} when this appears -- CLAUDE.md 7o follow-up) when a
 * real client staff member's own LGU has been paused by a platform admin
 * from /admin, e.g. for non-payment. Deliberately plain inline styles,
 * matching apply/login/status/verify's self-contained pattern, since this
 * is effectively its own standalone page even though it lives inside the
 * dashboard route tree.
 */
export function PausedNotice() {
  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#f4f6fb" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 40, maxWidth: 420, width: "100%", textAlign: "center", border: "0.5px solid #e5e7eb" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⏸️</div>
        <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Account Paused</h1>
        <p style={{ fontSize: 13.5, color: "#6b7280", marginBottom: 24, lineHeight: 1.6 }}>
          Your account is currently Paused, please contact your administrator for more info.
        </p>
        <div style={{ fontSize: 13, color: "#1a1a2e", marginBottom: 28, lineHeight: 1.9 }}>
          <p style={{ margin: 0 }}>
            📧 <a href="mailto:hello@muniserve.ph" style={{ color: "#0C447C" }}>hello@muniserve.ph</a>
          </p>
          <p style={{ margin: 0 }}>📱 0977-440-1374</p>
        </div>
        <SignOutButton />
      </div>
    </div>
  );
}
