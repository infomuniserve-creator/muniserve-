import Link from "next/link";
import type { BusinessProfile } from "@/lib/business-profile";
import { ThemeToggle } from "./theme-toggle";
import { GhostButton, MiniButton, NavLinkPendingHint, OutlineButton, PrimaryButton } from "./pending-ui";
export type { BusinessProfile };
export { GhostButton, MiniButton, OutlineButton, PrimaryButton };

/**
 * Shared visual language for every staff dashboard (BPLO, department,
 * treasury, mayor, and the Business Registry) -- Tailwind-based, replacing
 * the earlier inline-style prototype port. Palette/type tokens live in
 * globals.css (@theme); this file is components only. See the design
 * concept this was built from (card-based review queue, soft rounded
 * everything, brand navy-to-teal gradient) -- CLAUDE.md's design-system
 * note has the full rationale.
 */

export function peso(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  return "₱" + Math.round(amount).toLocaleString();
}

// ============================================================
// Icons -- small hand-authored line icons (stroke, round caps/joins) so
// they match the soft aesthetic without pulling in an icon library.
// ============================================================

type IconProps = { className?: string };
const iconBase = "shrink-0";

export function CheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={`${iconBase} ${className ?? "size-4"}`}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
export function XIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={`${iconBase} ${className ?? "size-4"}`}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
export function InfoIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={`${iconBase} ${className ?? "size-4"}`}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16.5v.01" />
    </svg>
  );
}
export function ClockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={`${iconBase} ${className ?? "size-4"}`}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}
export function BuildingIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`${iconBase} ${className ?? "size-4"}`}>
      <path d="M4 21V9l8-5 8 5v12" />
      <path d="M9 21v-7h6v7" />
    </svg>
  );
}
export function UserIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`${iconBase} ${className ?? "size-3.5"}`}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a8 8 0 0 1 16 0v1" />
    </svg>
  );
}
export function PinIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`${iconBase} ${className ?? "size-3"}`}>
      <path d="M12 21s-7-6.5-7-11a7 7 0 1 1 14 0c0 4.5-7 11-7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
export function FileIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`${iconBase} ${className ?? "size-3.5"}`}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}
export function SearchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={`${iconBase} ${className ?? "size-4"}`}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={`${iconBase} ${className ?? "size-4"}`}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
export function RefreshIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={`${iconBase} ${className ?? "size-4"}`}>
      <path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}
export function ArrowLeftIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`${iconBase} ${className ?? "size-4"}`}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 5 5v1" />
    </svg>
  );
}
export function SettingsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`${iconBase} ${className ?? "size-4"}`}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// ============================================================
// Status → color mapping. Literal Tailwind class strings throughout
// (never template-built) so the compiler's class scanner picks them up.
// ============================================================

export type StatusKind =
  | "pending"
  | "approved"
  | "approved_with_condition"
  | "rejected"
  | "request_more_info";

const STATUS_STYLES: Record<StatusKind, { bg: string; text: string }> = {
  pending: { bg: "bg-warn-bg", text: "text-warn-ink" },
  approved: { bg: "bg-good-bg", text: "text-good-ink" },
  approved_with_condition: { bg: "bg-cond-bg", text: "text-cond-ink" },
  rejected: { bg: "bg-bad-bg", text: "text-bad-ink" },
  request_more_info: { bg: "bg-info-bg", text: "text-info-ink" },
};

function statusClasses(status: string): string {
  const s = STATUS_STYLES[status as StatusKind] ?? STATUS_STYLES.pending;
  return `${s.bg} ${s.text}`;
}

export function Pill({ label, status, icon }: { label: string; status: string; icon?: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${statusClasses(status)}`}>
      {icon}
      {label}
    </span>
  );
}

export function Badge({ label, status }: { label: string; status: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${statusClasses(status)}`}>
      {label}
    </span>
  );
}

/**
 * Pill variant keyed by the same "good/warn/bad/info/neutral/cond" tone
 * vocabulary as StatCard, for statuses that aren't one of department_
 * reviews.decision's five literal values (business registry status,
 * dept-pending indicators, etc).
 */
const TONE_CLASSES: Record<string, string> = {
  good: "bg-good-bg text-good-ink",
  warn: "bg-warn-bg text-warn-ink",
  bad: "bg-bad-bg text-bad-ink",
  info: "bg-info-bg text-info-ink",
  cond: "bg-cond-bg text-cond-ink",
  male: "bg-male-bg text-male-ink",
  female: "bg-female-bg text-female-ink",
  neutral: "bg-surface-3 text-ink-soft",
};

export function TonePill({ label, tone, dot }: { label: string; tone: "good" | "warn" | "bad" | "info" | "cond" | "male" | "female" | "neutral"; dot?: boolean }) {
  const dotClasses: Record<string, string> = {
    good: "bg-good", warn: "bg-warn", bad: "bg-bad", info: "bg-info", cond: "bg-cond", male: "bg-male", female: "bg-female", neutral: "bg-ink-faint",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-bold ${TONE_CLASSES[tone]}`}>
      {dot && <span className={`size-2 shrink-0 rounded-full ${dotClasses[tone]}`} />}
      {label}
    </span>
  );
}

// ============================================================
// Layout primitives
// ============================================================

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-border bg-surface shadow-[0_1px_2px_rgba(23,33,66,0.05),0_10px_28px_-12px_rgba(23,33,66,0.14)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_10px_28px_-14px_rgba(0,0,0,0.5)] ${className}`}>
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-border-strong bg-surface px-6 py-7 text-center text-[13.5px] text-ink-soft">
      {children}
    </div>
  );
}

/**
 * auto-fit instead of a fixed column count: a page with 3 stat cards
 * (Mayor) gets 3 even wide columns, a page with 6 (BPLO) gets all 6 in
 * one row on a wide-enough screen, without either page hardcoding the
 * other's card count. Matches the original design concept's own stat
 * card grid (reference/MuniServe_Interactive_Prototype.html).
 */
export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="mb-8 grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3.5">{children}</div>;
}

/**
 * Tone now colors the whole card, not just the icon chip -- the project
 * owner asked for "a color that matches their status" so each stage
 * reads at a glance instead of every card looking the same. Built as its
 * own bordered surface rather than wrapping Card, since Card hardcodes
 * bg-surface and a plain class-string append can't reliably override
 * that (Tailwind's cascade order isn't JSX order).
 */
export function StatCard({ label, value, icon, tone = "neutral" }: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  tone?: "good" | "warn" | "bad" | "info" | "male" | "female" | "neutral";
}) {
  const toneClasses: Record<string, string> = {
    good: "bg-good-bg text-good-ink",
    warn: "bg-warn-bg text-warn-ink",
    bad: "bg-bad-bg text-bad-ink",
    info: "bg-info-bg text-info-ink",
    male: "bg-male-bg text-male-ink",
    female: "bg-female-bg text-female-ink",
    neutral: "bg-surface-3 text-ink-faint",
  };
  return (
    <div
      className={`flex flex-col gap-2 rounded-3xl border border-border p-4 shadow-[0_1px_2px_rgba(23,33,66,0.05),0_10px_28px_-12px_rgba(23,33,66,0.14)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_10px_28px_-14px_rgba(0,0,0,0.5)] ${toneClasses[tone]}`}
    >
      {icon && <span className="flex size-8 items-center justify-center rounded-xl bg-white/55 dark:bg-black/25">{icon}</span>}
      <div className="font-display text-[26px] font-bold leading-none tabular-nums">{value}</div>
      <div className="text-[12.5px] font-bold opacity-80">{label}</div>
    </div>
  );
}

export function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-3">
      <h2 className="font-display text-[18px] font-bold text-ink">{title}</h2>
      {sub && <span className="text-[12.5px] text-ink-faint">{sub}</span>}
    </div>
  );
}

/**
 * A collapsed-by-default section wrapper (2026-08-17) -- Settings grew to
 * ~11 sections (staff, fees, barangays, CEDULA, ...), and the project
 * owner flagged the page as taking up too much space with everything
 * always expanded. `<details>`/`<summary>` rather than a "use client"
 * toggle -- no client state needed, and this page's own forms already
 * work the same way without JS. `summary::-webkit-details-marker` is
 * already hidden globally (globals.css) and `.chev`'s rotation-on-open
 * rule already exists (the Business Registry's own expand rows, CLAUDE.md
 * 7dd, use the identical pattern) -- reused here rather than a new rule.
 */
export function CollapsibleSection({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <details className="mb-9">
      <summary className="mb-3.5 flex cursor-pointer flex-wrap items-baseline justify-between gap-3">
        <span className="flex items-center gap-2">
          <ChevronRightIcon className="chev size-3.5 shrink-0 text-ink-faint" />
          <h2 className="font-display text-[18px] font-bold text-ink">{title}</h2>
        </span>
        {sub && <span className="text-[12.5px] text-ink-faint">{sub}</span>}
      </summary>
      {children}
    </details>
  );
}

/** Kept for the few spots that just need a plain label, not a full section head. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 mt-6 text-[13px] font-bold text-ink-soft">{children}</p>;
}

export function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-3 border-b border-border px-4.5 py-3 last:border-b-0">{children}</div>;
}

// ============================================================
// Top bar + nav tabs -- shared shell for every dashboard page.
// Server Component: which tab is active is passed in explicitly rather
// than read from usePathname, so nothing here needs "use client".
// ============================================================

export function DashboardTopBar({
  officeLabel,
  officeSub,
  initials,
  active,
  applicationsHref,
  settingsHref,
  auditHref,
  statsHref,
  rightSlot,
}: {
  officeLabel: string;
  officeSub: string;
  initials: string;
  active: "applications" | "businesses" | "settings" | "audit" | "stats";
  applicationsHref: string;
  /** Only BPLO has settings (src/app/dashboard/settings) -- staff-account management lives there too now (2026-08-15), no longer its own top-nav tab. Rendered as an icon button, not a nav pill, since it's a shortcut rather than a primary section. */
  settingsHref?: string;
  /** BPLO and Mayor both see the Audit Trail (CLAUDE.md 7o follow-up, the project owner asked for Mayor explicitly) -- a real nav pill, not an icon, since it's a primary reporting section rather than an occasional admin task like Settings. */
  auditHref?: string;
  /** Same gating as auditHref -- Performance Stats, also BPLO + Mayor. */
  statsHref?: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border bg-surface px-5 py-3.5 shadow-[0_1px_2px_rgba(23,33,66,0.05),0_10px_28px_-12px_rgba(23,33,66,0.14)]">
      <div className="flex items-center gap-2.5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-navy via-[#1470a8] to-brand-teal shadow-[0_4px_10px_-2px_rgba(15,184,140,0.4)]">
          <BuildingIcon className="size-5 text-white" />
        </div>
        <span className="font-display text-[17px] font-bold tracking-tight">
          <span className="text-brand-navy">Muni</span>
          <span className="text-brand-teal">Serve</span>
        </span>
        <span className="ml-1 flex flex-col border-l border-border-strong pl-2.5 leading-tight">
          <strong className="text-[12.5px] font-bold text-ink">{officeLabel}</strong>
          <span className="text-[12px] text-ink-soft">{officeSub}</span>
        </span>
      </div>

      <nav className="flex gap-0.5 rounded-full bg-surface-2 p-0.5">
        <Link
          href={applicationsHref}
          className={`rounded-full px-4.5 py-2 font-display text-[13px] font-bold transition-colors ${
            active === "applications" ? "bg-surface text-brand-navy shadow-sm" : "text-ink-soft hover:text-ink"
          }`}
        >
          Applications
          <NavLinkPendingHint />
        </Link>
        <Link
          href="/dashboard/businesses"
          className={`rounded-full px-4.5 py-2 font-display text-[13px] font-bold transition-colors ${
            active === "businesses" ? "bg-surface text-brand-navy shadow-sm" : "text-ink-soft hover:text-ink"
          }`}
        >
          Businesses
          <NavLinkPendingHint />
        </Link>
        {auditHref && (
          <Link
            href={auditHref}
            className={`rounded-full px-4.5 py-2 font-display text-[13px] font-bold transition-colors ${
              active === "audit" ? "bg-surface text-brand-navy shadow-sm" : "text-ink-soft hover:text-ink"
            }`}
          >
            Audit Trail
            <NavLinkPendingHint />
          </Link>
        )}
        {statsHref && (
          <Link
            href={statsHref}
            className={`rounded-full px-4.5 py-2 font-display text-[13px] font-bold transition-colors ${
              active === "stats" ? "bg-surface text-brand-navy shadow-sm" : "text-ink-soft hover:text-ink"
            }`}
          >
            Performance Stats
            <NavLinkPendingHint />
          </Link>
        )}
      </nav>

      <div className="flex items-center gap-2.5">
        {settingsHref && (
          <Link
            href={settingsHref}
            title="Settings"
            className={`flex size-8.5 items-center justify-center rounded-full border transition-colors ${
              active === "settings"
                ? "border-brand-navy/20 bg-surface text-brand-navy shadow-sm"
                : "border-border-strong text-ink-soft hover:text-ink"
            }`}
          >
            <SettingsIcon className="size-4" />
          </Link>
        )}
        <ThemeToggle />
        {rightSlot}
        <div className="flex size-8.5 items-center justify-center rounded-full border border-border-strong bg-surface-3 font-display text-[12.5px] font-bold text-brand-navy">
          {initials}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Button variants -- shared so every "approve / condition / info / reject"
// action row (BPLO's own review, department's own review, BPLO acting on
// a department's behalf) looks and behaves identically. Definitions live
// in pending-ui.tsx now (2026-08-16) -- re-exported here unchanged so
// every existing `import { PrimaryButton, ... } from "../ui"` call site
// across the dashboard keeps working with no changes, but every one of
// them now shows a spinner and goes inert while its form is submitting
// (useFormStatus) instead of giving no feedback at all.
// ============================================================

/**
 * The four decision buttons every review surface uses (BPLO initial
 * review, BPLO assessment isn't decision-based, department's own review,
 * BPLO acting on a department's behalf). `compact` renders MiniButtons
 * without icons for the "act on behalf" inline row.
 *
 * `disableApprove` (2026-08-14 follow-up): only `InitialReviewCard`
 * passes this, when the business has no LBT category set yet -- greys
 * out just the two decisions that would advance the application into
 * department review, while leaving Request info/Reject clickable (those
 * don't need it). This is the primary guard against the LBT-category
 * dead end; `submitInitialReview`'s own server-side check
 * (`requireLbtCategorySet`) is the backstop for a stale form submitting
 * anyway, not the first line of defense.
 */
export function DecisionButtons({ compact, disableApprove }: { compact?: boolean; disableApprove?: boolean }) {
  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5">
        <MiniButton type="submit" name="decision" value="approved" tone="good" disabled={disableApprove}>Approve</MiniButton>
        <MiniButton type="submit" name="decision" value="approved_with_condition" tone="good" disabled={disableApprove}>Approve w/ condition</MiniButton>
        <MiniButton type="submit" name="decision" value="request_more_info" tone="info">Request info</MiniButton>
        <MiniButton type="submit" name="decision" value="rejected" tone="bad">Reject</MiniButton>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <PrimaryButton type="submit" name="decision" value="approved" disabled={disableApprove}><CheckIcon />Approve</PrimaryButton>
      <OutlineButton type="submit" name="decision" value="approved_with_condition" tone="cond" disabled={disableApprove}><InfoIcon />Approve with condition</OutlineButton>
      <OutlineButton type="submit" name="decision" value="request_more_info" tone="info"><InfoIcon />Request more info</OutlineButton>
      <OutlineButton type="submit" name="decision" value="rejected" tone="bad"><XIcon />Reject</OutlineButton>
    </div>
  );
}

export function NotesField(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return (
    <textarea
      {...rest}
      className={`mb-3 min-h-[52px] w-full resize-y rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-[13px] text-ink placeholder:text-ink-faint ${className}`}
    />
  );
}

// ============================================================
// Workflow stepper -- the 8-stage pipeline every application moves
// through (CLAUDE.md section 6 / 7i). Terminal exception states
// (returned / rejected) don't render a linear stepper -- a Badge
// elsewhere already communicates those. "Submitted" isn't its own step
// here -- submit-application/route.ts creates every application already
// at pending_bplo_initial, so that status value is effectively never
// observed on a real row; it's folded into "Initial review" below
// rather than reserving a step nothing ever visibly occupies.
// ============================================================

const STEPS = [
  "Initial review", "Departments review", "Assessment review", "Treasurer approval",
  "For printing", "Mayor's signature", "For release", "Released",
];

const STATUS_STEP_INDEX: Record<string, number> = {
  submitted: 0,
  pending_bplo_initial: 0,
  pending_dept_review: 1,
  pending_bplo_assessment: 2,
  pending_payment: 3,
  pending_printing: 4,
  pending_mayor: 5,
  pending_release: 6,
  released: 7,
};

export function WorkflowStepper({ status }: { status: string }) {
  const current = STATUS_STEP_INDEX[status];
  if (current === undefined) return null;

  return (
    <div className="mb-4 flex items-center overflow-x-auto pb-1">
      {STEPS.map((label, i) => (
        <div key={label} className="flex shrink-0 items-center">
          {i > 0 && <div className={`mx-0.5 h-0.5 w-5.5 shrink-0 ${i <= current ? "bg-good" : "bg-border-strong"}`} />}
          <div className="flex shrink-0 items-center gap-1.5">
            <span
              className={`flex size-5 items-center justify-center rounded-full border-2 text-[10px] font-bold ${
                i < current
                  ? "border-good bg-good text-white"
                  : i === current
                    ? "border-brand-teal bg-brand-teal text-white shadow-[0_0_0_4px_var(--color-good-bg)]"
                    : "border-border-strong bg-surface text-ink-faint"
              }`}
            >
              {i < current ? "✓" : i + 1}
            </span>
            <span className={`whitespace-nowrap text-[11px] font-bold ${i <= current ? "text-ink" : "text-ink-faint"}`}>{label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Business profile detail grid -- shared by every review card and the
// Business Registry's expanded row. Rows with no value are omitted
// rather than padding the grid with dashes.
// ============================================================

export function BusinessProfileBlock({
  legacyAddress, profile, applicationType, basisAmount,
}: {
  legacyAddress: string | null;
  profile: BusinessProfile | null;
  applicationType: string;
  basisAmount: number | null;
}) {
  const structuredAddress = profile
    ? [profile.unitStreet, profile.cityTown, profile.barangay, profile.province, profile.zipCode].filter(Boolean).join(", ")
    : "";
  const address = structuredAddress || legacyAddress;

  const rows: [string, string][] = [
    ["Nature of business", profile?.natureOfBusiness ?? "—"],
    ["LBT category", profile?.lbtCategory ?? "—"],
    [applicationType === "new" ? "Capital investment" : "Gross sales (preceding year)", peso(basisAmount)],
  ];
  if (profile?.organizationType) rows.push(["Organization type", profile.organizationType]);
  if (profile?.registrationAuthority || profile?.registrationNo)
    rows.push(["Registration", [profile.registrationAuthority, profile.registrationNo].filter(Boolean).join(" — ")]);
  if (profile?.businessTaxPayment) rows.push(["Business tax payment", profile.businessTaxPayment]);
  if (profile?.tin) rows.push(["TIN", profile.tin]);
  if (profile?.taxType) rows.push(["Tax type", profile.taxType]);
  if (profile?.tradeName) rows.push(["Trade/franchise name", profile.tradeName]);
  if (profile?.premisesOwnership) rows.push(["Premises ownership", profile.premisesOwnership]);
  if (profile?.premisesOwnership === "Owned" && profile.taxDeclarationNo)
    rows.push(["Tax declaration no.", profile.taxDeclarationNo]);
  if (profile?.premisesOwnership && profile.premisesOwnership !== "Owned" && (profile.lessorName || profile.monthlyRent))
    rows.push(["Lessor", [profile.lessorName, profile.lessorContactNo, profile.monthlyRent && `₱${profile.monthlyRent}/mo`].filter(Boolean).join(" · ")]);
  if (profile?.hasEmployees === "Yes")
    rows.push(["Employees", `${profile.maleEmployeeCount ?? 0} male, ${profile.femaleEmployeeCount ?? 0} female (${profile.employeesResidingInLguCount ?? 0} residing in LGU)`]);
  else if (profile?.hasEmployees === "No") rows.push(["Employees", "None"]);
  if (profile?.billiardTableCount != null) rows.push(["Billiard tables", String(profile.billiardTableCount)]);
  if (profile?.lodgerCount != null) rows.push(["Lodgers/rooms", String(profile.lodgerCount)]);
  if (profile?.landAreaHectares != null) rows.push(["Land area", `${profile.landAreaHectares} ha`]);
  if (profile?.guardPostCount != null) rows.push(["Guard posts", String(profile.guardPostCount)]);
  if (profile?.warehouseFloorAreaSqm != null) rows.push(["Floor area", `${profile.warehouseFloorAreaSqm} sqm`]);
  if (profile?.seatingCapacity != null) rows.push(["Seating capacity", String(profile.seatingCapacity)]);
  if (profile?.isAircon) rows.push(["Air-conditioned", profile.isAircon]);
  if (profile?.isBranchOffice) rows.push(["Branch office", profile.isBranchOffice]);
  if (profile?.animalCount != null) rows.push(["Number of animals", String(profile.animalCount)]);

  return (
    <div className="mb-4 rounded-2xl bg-surface-2 p-4">
      {address && (
        <p className="mb-2.5 flex items-center gap-1 border-b border-border pb-2.5 text-[12.5px] text-ink-soft">
          <PinIcon className="size-3 text-ink-faint" />
          {address}
        </p>
      )}
      <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <div className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">{label}</div>
            <div className="text-[14px] font-bold text-ink">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Documents list -- shared by BPLO's initial review card and the
// department review card.
// ============================================================

export function DocumentList({
  documents, signedUrls,
}: {
  documents: { id: string; document_type: string | null }[];
  signedUrls: (string | null)[];
}) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-soft">Documents submitted</p>
      {documents.length === 0 ? (
        <p className="text-[12.5px] text-ink-faint">No documents uploaded.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {documents.map((d, i) =>
            signedUrls[i] ? (
              <a
                key={d.id}
                href={signedUrls[i]!}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] font-bold text-ink transition-colors hover:border-brand-teal hover:bg-good-bg"
              >
                <FileIcon className="size-3.5 text-good" />
                {d.document_type}
              </a>
            ) : (
              <span key={d.id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12.5px] font-bold text-ink-faint">
                <FileIcon className="size-3.5" />
                {d.document_type} (link unavailable)
              </span>
            )
          )}
        </div>
      )}
    </div>
  );
}
