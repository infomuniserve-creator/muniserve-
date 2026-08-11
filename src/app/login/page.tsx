"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

/**
 * Staff login. Google OAuth only -- per CLAUDE.md rule #10, passwords are
 * for applicants to never need; staff use their institutional Google
 * account, matched to a staff_users row by email after they sign in
 * (see /auth/callback).
 */
export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    setIsLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setError(error.message);
      setIsLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#f4f6fb" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 40, maxWidth: 380, width: "100%", border: "0.5px solid #e5e7eb", textAlign: "center" }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>MuniServe</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 28 }}>Staff sign-in — San Miguel, Bulacan</p>
        <button
          onClick={signInWithGoogle}
          disabled={isLoading}
          style={{
            width: "100%",
            padding: "10px 16px",
            borderRadius: 8,
            border: "0.5px solid #e5e7eb",
            background: isLoading ? "#f4f6fb" : "#fff",
            fontSize: 14,
            cursor: isLoading ? "default" : "pointer",
          }}
        >
          {isLoading ? "Redirecting…" : "Sign in with Google"}
        </button>
        {error && (
          <p style={{ fontSize: 12, color: "#791F1F", marginTop: 16 }}>{error}</p>
        )}
        <p style={{ fontSize: 11, color: "#6b7280", marginTop: 24 }}>
          Your Google account must be provisioned as staff by BPLO before you can sign in.
        </p>
      </div>
    </div>
  );
}
