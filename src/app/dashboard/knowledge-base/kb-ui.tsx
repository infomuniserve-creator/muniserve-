import type { ReactNode } from "react";

/**
 * Shared presentational pieces for the Knowledge Base (2026-08-21) --
 * every "screenshot" in this KB is a real, hand-built recreation using
 * this app's own actual design tokens (the same classes bplo/page.tsx,
 * settings/page.tsx, etc. already use), not a raster image. Two reasons,
 * both deliberate: this environment has no reliable way to capture a real
 * screenshot of a live staff session (every dashboard route needs a real
 * Google OAuth login, which can't be driven here -- this project's own
 * established fallback for verifying session-gated UI throughout this
 * whole build has always been "recreate the real component/classes
 * directly," never a photo), and a hand-built recreation can never go
 * stale the way a static image would the next time the real UI changes.
 * The project owner approved exactly this treatment in a design mockup
 * before any of this was written.
 */

export function KbSection({ id, icon, title, sub, children }: { id: string; icon: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-14 scroll-mt-24">
      <h2 className="mb-1.5 flex items-center gap-2.5 font-display text-[20px] font-bold text-ink">
        <span aria-hidden>{icon}</span> {title}
      </h2>
      <p className="mb-5 max-w-[60ch] text-[13.5px] leading-relaxed text-ink-soft">{sub}</p>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function KbCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(23,33,66,0.05),0_10px_28px_-12px_rgba(23,33,66,0.14)]">
      {title && <h3 className="mb-2 font-display text-[14.5px] font-bold text-ink">{title}</h3>}
      <div className="flex flex-col gap-2.5 text-[13.5px] leading-relaxed text-ink [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mb-1 [&_b]:font-bold [&_b]:text-ink">
        {children}
      </div>
    </div>
  );
}

const TIP_TONE = {
  info: { bg: "bg-info-bg", ink: "text-info-ink", icon: "💡" },
  warn: { bg: "bg-warn-bg", ink: "text-warn-ink", icon: "⚠️" },
  good: { bg: "bg-good-bg", ink: "text-good-ink", icon: "✅" },
} as const;

export function KbTip({ tone = "info", children }: { tone?: keyof typeof TIP_TONE; children: ReactNode }) {
  const t = TIP_TONE[tone];
  return (
    <div className={`flex items-start gap-2.5 rounded-2xl px-4 py-3 text-[12.5px] font-bold leading-relaxed ${t.bg} ${t.ink}`}>
      <span className="mt-0.5 shrink-0" aria-hidden>{t.icon}</span>
      <span>{children}</span>
    </div>
  );
}

/** The one place a real-looking municipality name gets blurred out (2026-08-21, project owner's own request) -- so every KB "screenshot" reads as genuinely from a real, live MuniServe client without naming which one. */
export function BlurredMunicipality({ text = "San Miguel, Bulacan" }: { text?: string }) {
  return (
    <span className="relative inline-block">
      <span className="select-none rounded blur-sm">{text}</span>
      <span className="sr-only">(municipality name hidden)</span>
    </span>
  );
}

/** A "screenshot" frame -- real Tailwind classes throughout, not a raster image (see the module doc comment above). */
export function KbShot({ caption, children }: { caption?: string; children: ReactNode }) {
  return (
    <div className="my-2">
      <div className="overflow-hidden rounded-2xl border border-border-strong shadow-[0_1px_2px_rgba(23,33,66,0.05),0_10px_28px_-12px_rgba(23,33,66,0.14)]">
        <div className="flex gap-1.5 border-b border-border bg-surface-2 px-3 py-2">
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="size-2.5 rounded-full bg-border-strong" />
        </div>
        <div className="bg-surface p-4">{children}</div>
      </div>
      {caption && <p className="mt-1.5 text-center text-[11.5px] text-ink-faint">{caption}</p>}
    </div>
  );
}

/** A tiny recreation of DashboardTopBar's own left-hand identity block, for KbShot screenshots -- not the real component (which needs a live session), just its visual shape. */
export function MiniTopBar({ officeLabel, active }: { officeLabel: string; active?: string }) {
  const tabs = ["Applications", "Businesses"];
  return (
    <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-[11px]">
      <div className="flex items-center gap-2">
        <div className="flex size-6 items-center justify-center rounded-lg bg-gradient-to-br from-brand-navy to-brand-teal text-[10px] text-white">🏛️</div>
        <span className="font-display text-[12px] font-bold">
          <span className="text-brand-navy">Muni</span><span className="text-brand-teal">Serve</span>
        </span>
        <span className="ml-1 border-l border-border-strong pl-2 font-bold text-ink-soft">
          {officeLabel} · <BlurredMunicipality />
        </span>
      </div>
      <div className="flex gap-1 rounded-full bg-surface-2 p-0.5">
        {tabs.map((t) => (
          <span key={t} className={`rounded-full px-2.5 py-1 font-bold ${t === active ? "bg-surface text-brand-navy" : "text-ink-faint"}`}>{t}</span>
        ))}
      </div>
    </div>
  );
}

export function KbRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dashed border-border py-1.5 text-[11.5px] last:border-b-0">
      <span className="text-ink-soft">{label}</span>
      <span className="font-bold text-ink">{value}</span>
    </div>
  );
}

const CHAN_TONE = { sms: "bg-good-bg text-good-ink", email: "bg-info-bg text-info-ink" } as const;

export function KbChannel({ kind }: { kind: "sms" | "email" }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${CHAN_TONE[kind]}`}>{kind}</span>;
}
