"use client";

import { useEffect, useRef, useState } from "react";
import { useLinkStatus } from "next/link";
import { useFormStatus } from "react-dom";

/**
 * Click feedback (2026-08-16) -- the project owner's own words: "when I
 * click on anything, it doesn't show anything, it's as if there's
 * nothing happening." True for every button on every dashboard page --
 * approve/reject, toggles, save buttons -- since a plain `<form
 * action={serverAction}>` gives zero visual feedback while the action
 * runs, by default. Two separate mechanisms, matched to two separate
 * causes:
 *
 * - Form/server-action submits (the vast majority of "nothing happens"
 *   reports -- Approve, every Settings toggle, Mark as printed/released,
 *   etc.): PrimaryButton/OutlineButton/MiniButton/GhostButton below wrap
 *   the originals (ui.tsx re-exports these, not its own copies, so
 *   every existing call site across the whole dashboard is fixed at
 *   once with no changes needed anywhere else) with React's
 *   `useFormStatus()` -- stable, built into react-dom since React 19,
 *   already this project's version. A button shows a spinner and goes
 *   inert the instant its enclosing form starts submitting, which also
 *   incidentally prevents a double-click firing the same action twice.
 *   `useFormStatus()` returns `{ pending: false }` by default when a
 *   button isn't inside a `<form>` at all (e.g. the CSV-import wizard's
 *   plain onClick buttons) -- safe to apply everywhere unconditionally,
 *   confirmed against React's own docs before relying on it.
 *
 * - Tab/nav-pill navigation (DashboardTopBar): `NavLinkPendingHint`
 *   uses `useLinkStatus()`, the App-Router-native hook for this
 *   (introduced Next 15.3 -- confirmed against this project's actual
 *   installed Next 16 docs before using it, per AGENTS.md's own warning
 *   not to trust training-data Next.js conventions). Deliberately a
 *   secondary, subtle touch, not the primary fix -- Next's own docs say
 *   outright a route with a `loading.js` file (this dashboard already
 *   has one, since section 7e) may skip the pending phase entirely on a
 *   fast navigation. This just closes the small gap before that
 *   skeleton appears.
 */

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`${className ?? "size-3.5"} animate-spin motion-reduce:animate-none`} aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2.4} strokeOpacity={0.25} />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" />
    </svg>
  );
}

/** type="button" (a plain client-managed action, not a form submit) never shows pending, regardless of context -- only the default/"submit" type is form-driven. */
function useSubmitPending(type: React.ButtonHTMLAttributes<HTMLButtonElement>["type"]): boolean {
  const { pending } = useFormStatus();
  return pending && type !== "button";
}

const btnBase = "inline-flex items-center gap-1.5 rounded-full text-[13px] font-bold transition-transform active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-40 disabled:active:scale-100";

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", children, disabled, ...rest } = props;
  const isPending = useSubmitPending(props.type);
  return (
    <button
      {...rest}
      disabled={disabled || isPending}
      className={`${btnBase} border border-good bg-good px-4.5 py-2.5 text-white shadow-[0_6px_14px_-4px_rgba(31,169,113,0.45)] hover:bg-[#188e5e] ${className}`}
    >
      {isPending && <SpinnerIcon />}
      {children}
    </button>
  );
}

export function OutlineButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone: "cond" | "info" | "bad" | "neutral" }) {
  const { className = "", children, tone, disabled, ...rest } = props;
  const isPending = useSubmitPending(props.type);
  const toneClasses: Record<string, string> = {
    cond: "border-cond text-cond hover:bg-cond-bg",
    info: "border-info text-info hover:bg-info-bg",
    bad: "border-bad text-bad hover:bg-bad-bg",
    neutral: "border-border-strong text-ink-soft hover:bg-surface-2 hover:text-ink",
  };
  return (
    <button {...rest} disabled={disabled || isPending} className={`${btnBase} border bg-surface px-4.5 py-2.5 ${toneClasses[tone]} ${className}`}>
      {isPending && <SpinnerIcon />}
      {children}
    </button>
  );
}

export function MiniButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "good" | "info" | "bad" | "neutral" }) {
  const { className = "", children, tone = "good", disabled, ...rest } = props;
  const isPending = useSubmitPending(props.type);
  const toneClasses: Record<string, string> = {
    good: "border-brand-teal text-brand-teal hover:bg-good-bg",
    info: "border-info text-info hover:bg-info-bg",
    bad: "border-bad text-bad hover:bg-bad-bg",
    neutral: "border-border-strong text-ink-soft hover:bg-surface-2",
  };
  return (
    <button
      {...rest}
      disabled={disabled || isPending}
      className={`inline-flex items-center gap-1.5 rounded-full border bg-surface px-3.5 py-1.5 text-[12px] font-bold transition-colors disabled:pointer-events-none disabled:opacity-40 ${toneClasses[tone]} ${className}`}
    >
      {isPending && <SpinnerIcon className="size-3" />}
      {children}
    </button>
  );
}

export function GhostButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", children, disabled, ...rest } = props;
  const isPending = useSubmitPending(props.type);
  return (
    <button
      {...rest}
      disabled={disabled || isPending}
      className={`inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-[12.5px] font-bold text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-40 ${className}`}
    >
      {isPending && <SpinnerIcon className="size-3" />}
      {children}
    </button>
  );
}

/**
 * A Save button that stays visibly confirmed for a few seconds after a
 * real save completes (2026-08-22) -- reported directly: saving a
 * per-barangay rate (Delivery Fee, and the identical Barangay Clearance
 * list right above it) genuinely worked every time, but the plain
 * spinner-then-clear feedback MiniButton already gives every Save button
 * is easy to miss entirely when clicking through dozens of individual
 * rows in a row, since a flat-rate UPDATE round-trips fast enough that
 * the spinner can flash and clear before it registers.
 *
 * Tracks the pending -> not-pending transition (not just "is it pending
 * right now") via a ref holding the PREVIOUS pending value, checked
 * before overwriting it each render -- `pending` only means "submitting
 * right now," it says nothing on its own about whether a submission
 * *just* finished, which is the actual signal this needs.
 */
export function SaveButtonWithConfirmation({ label = "Save" }: { label?: string }) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    const wasPendingBefore = wasPending.current;
    wasPending.current = pending;
    if (wasPendingBefore && !pending) {
      setJustSaved(true);
      const timer = setTimeout(() => setJustSaved(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [pending]);

  return (
    <span className="inline-flex items-center gap-2">
      <MiniButton type="submit" tone="neutral">{label}</MiniButton>
      <span className={`text-[11.5px] font-bold text-good-ink transition-opacity ${justSaved ? "opacity-100" : "opacity-0"}`} aria-live="polite">
        {justSaved ? "Saved ✓" : ""}
      </span>
    </span>
  );
}

/**
 * A small pulsing dot next to a nav pill's label, visible only while
 * that specific Link is navigating (must be rendered as a descendant of
 * the `<Link>` it tracks -- useLinkStatus's own requirement). Fixed-size
 * and always rendered (opacity/visibility toggle, not conditional
 * mounting) per Next's own guidance, so it never causes layout shift.
 */
export function NavLinkPendingHint() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`ml-1.5 inline-block size-1.5 rounded-full bg-current transition-opacity ${pending ? "animate-pulse opacity-70" : "opacity-0"}`}
    />
  );
}
