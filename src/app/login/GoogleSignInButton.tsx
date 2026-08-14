"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

/** Just the interactive part of the login page -- split out so the page itself can stay a Server Component and fetch the LGU's display info (CLAUDE.md 7n) without needing a client-side round trip for what's otherwise static text. */
export function GoogleSignInButton() {
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
    <>
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
      {error && <p style={{ fontSize: 12, color: "#791F1F", marginTop: 16 }}>{error}</p>}
    </>
  );
}
