import { resolveLguDisplay } from "@/lib/lgu";
import { headers } from "next/headers";
import Link from "next/link";

// force-dynamic: same reasoning as apply/page.tsx -- was static (no
// server data) before this page read from the DB.
export const dynamic = "force-dynamic";

/** Resolves from the request's own subdomain (CLAUDE.md 7o) -- portal.muniserve.ph/root shows San Miguel (the pilot fallback), a new client's own subdomain shows theirs. */
export default async function RootPage() {
  const host = (await headers()).get("host");
  const lgu = await resolveLguDisplay(host);

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#f4f6fb" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 40, maxWidth: 420, width: "100%", textAlign: "center", border: "0.5px solid #e5e7eb" }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Business Permits</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 28 }}>{lgu.name}, {lgu.province}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Link href="/apply" style={linkBtnStyle}>Apply for a business permit</Link>
          <Link href="/login" style={linkBtnStyle}>Staff sign-in</Link>
        </div>
      </div>
    </div>
  );
}

const linkBtnStyle: React.CSSProperties = {
  display: "block",
  padding: "10px 16px",
  borderRadius: 8,
  border: "0.5px solid #e5e7eb",
  fontSize: 14,
  textDecoration: "none",
  color: "#1a1a2e",
};
