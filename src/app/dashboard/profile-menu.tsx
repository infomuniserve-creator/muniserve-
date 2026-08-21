"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * The top bar's own avatar circle (2026-08-21, project owner's own
 * request) -- used to be a plain, non-interactive initials badge with
 * "Sign out" living as its own separate pill button next to it
 * (sign-out-button.tsx, still used as-is on the pre-dashboard-shell
 * screens -- Not Provisioned, Paused -- that have no top bar at all).
 * Clicking the avatar now opens a small menu naming the actual signed-in
 * person (not just their office/role, which `initials` itself already
 * represents -- BPLO/TR/MO/department initials, staff.ts's
 * officeIdentity()) with "Sign out" underneath it, freeing up the top
 * bar's own right-hand slot for the new Knowledge Base link.
 *
 * Click-outside-to-close mirrors the same pattern already established in
 * this codebase's other custom dropdown (ApplyPageClient.tsx's
 * SearchableSelect) rather than inventing a second technique.
 */
export function ProfileMenu({ fullName, initials }: { fullName: string; initials: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={fullName}
        className="flex size-8.5 items-center justify-center rounded-full border border-border-strong bg-surface-3 font-display text-[12.5px] font-bold text-brand-navy transition-colors hover:bg-surface-2"
      >
        {initials}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-20 w-52 rounded-2xl border border-border bg-surface p-1.5 shadow-[0_12px_28px_-10px_rgba(23,33,66,0.28)]"
        >
          <p className="truncate px-3 py-2 text-[13px] font-bold text-ink">{fullName}</p>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="w-full rounded-xl px-3 py-2 text-left text-[12.5px] font-bold text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
