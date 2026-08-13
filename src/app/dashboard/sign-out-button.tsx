"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      className="rounded-full border border-border px-3.5 py-1.5 text-[12.5px] font-bold text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
    >
      Sign out
    </button>
  );
}
