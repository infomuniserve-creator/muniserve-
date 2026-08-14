import { getPilotLguDisplay } from "@/lib/lgu";
import { GoogleSignInButton } from "./GoogleSignInButton";

/**
 * Staff login. Google OAuth only -- per CLAUDE.md rule #10, passwords are
 * for applicants to never need; staff use their institutional Google
 * account, matched to a staff_users row by email after they sign in
 * (see /auth/callback).
 *
 * A Server Component now (CLAUDE.md 7n) rather than fully client, so the
 * LGU subtitle can come from data instead of a hardcoded "San Miguel,
 * Bulacan" string -- the actual sign-in interactivity is split out into
 * GoogleSignInButton, the only part that needs to run in the browser.
 * Uses the pilot-LGU placeholder since there's no session yet to know
 * which LGU this staff member belongs to.
 *
 * force-dynamic: same reasoning as apply/page.tsx -- this used to be
 * static (no server data), so a build-time DB read/failure is a new
 * failure mode that shouldn't be allowed to fail the whole deployment.
 */
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const lgu = await getPilotLguDisplay();

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#f4f6fb" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 40, maxWidth: 380, width: "100%", border: "0.5px solid #e5e7eb", textAlign: "center" }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>MuniServe</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 28 }}>Staff sign-in — {lgu.name}, {lgu.province}</p>
        <GoogleSignInButton />
        <p style={{ fontSize: 11, color: "#6b7280", marginTop: 24 }}>
          Your Google account must be provisioned as staff by BPLO before you can sign in.
        </p>
      </div>
    </div>
  );
}
