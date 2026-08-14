import { resolveLguDisplay } from "@/lib/lgu";
import { headers } from "next/headers";
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
 *
 * Unlike apply/page.tsx, this is now a genuinely SHARED entry point
 * across every client LGU (CLAUDE.md 7o) -- a new client's staff invite
 * email deliberately points here (the shared domain, not their own
 * subdomain, so the link works immediately without waiting on DNS), so
 * showing a specific LGU's name unconditionally would be actively wrong
 * for anyone who isn't that one LGU. Only names a place when the visitor
 * is actually on that LGU's own subdomain (a real match, not the
 * pilot-LGU fallback) -- otherwise stays generic.
 *
 * force-dynamic: same reasoning as apply/page.tsx -- this used to be
 * static (no server data), so a build-time DB read/failure is a new
 * failure mode that shouldn't be allowed to fail the whole deployment.
 */
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const host = (await headers()).get("host");
  const lgu = await resolveLguDisplay(host);
  const onOwnSubdomain = host?.split(":")[0].toLowerCase() === `${lgu.subdomain}.muniserve.ph`;

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#f4f6fb" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 40, maxWidth: 380, width: "100%", border: "0.5px solid #e5e7eb", textAlign: "center" }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>MuniServe</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 28 }}>
          {onOwnSubdomain ? `Staff sign-in — ${lgu.name}, ${lgu.province}` : "Staff sign-in"}
        </p>
        <GoogleSignInButton />
        <p style={{ fontSize: 11, color: "#6b7280", marginTop: 24 }}>
          Your Google account must be provisioned as staff by BPLO before you can sign in.
        </p>
      </div>
    </div>
  );
}
