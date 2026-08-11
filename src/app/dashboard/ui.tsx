/**
 * Shared visual pieces for the staff dashboards, translated from
 * reference/MuniServe_Interactive_Prototype.html -- same colors, same
 * shapes, so the real dashboards read as continuations of that prototype
 * rather than a redesign. Kept as inline styles (no Tailwind yet) to stay
 * a direct, easy-to-diff port of the prototype's own inline-styled markup.
 */

export const colors = {
  textPrimary: "#1a1a2e",
  textSecondary: "#6b7280",
  border: "#e5e7eb",
  borderStrong: "#c7cbd1",
  surface1: "#f4f6fb",
  surface2: "#ffffff",
  warningBg: "#FAEEDA",
  warningText: "#854F0B",
  successBg: "#EAF3DE",
  successText: "#27500A",
  dangerBg: "#FCEBEB",
  dangerText: "#791F1F",
  accentBg: "#E6F1FB",
  accentText: "#0C447C",
  proBg: "#EEEDFE",
  proText: "#3C3489",
};

export type StatusKind =
  | "pending"
  | "approved"
  | "approved_with_condition"
  | "rejected"
  | "request_more_info";

export function statusColors(status: string): { bg: string; text: string } {
  if (status === "approved") return { bg: colors.successBg, text: colors.successText };
  if (status === "approved_with_condition") return { bg: colors.proBg, text: colors.proText };
  if (status === "rejected") return { bg: colors.dangerBg, text: colors.dangerText };
  if (status === "request_more_info") return { bg: colors.accentBg, text: colors.accentText };
  return { bg: colors.warningBg, text: colors.warningText };
}

export function peso(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  return "₱" + Math.round(amount).toLocaleString();
}

export function Badge({ label, status }: { label: string; status: string }) {
  const c = statusColors(status);
  return (
    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, whiteSpace: "nowrap", background: c.bg, color: c.text }}>
      {label}
    </span>
  );
}

export function Pill({ label, status }: { label: string; status: string }) {
  const c = statusColors(status);
  return (
    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, whiteSpace: "nowrap", background: c.bg, color: c.text }}>
      {label}
    </span>
  );
}

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: colors.surface1, borderRadius: 8, padding: "1rem" }}>
      <p style={{ fontSize: 13, color: colors.textSecondary, margin: "0 0 4px" }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 500, margin: 0 }}>{value}</p>
    </div>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ border: `0.5px solid ${colors.border}`, borderRadius: 8, ...style }}>
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 16, fontSize: 13, color: colors.textSecondary }}>{children}</div>
  );
}

export function TopBar({
  title,
  subtitle,
  initials,
  bg,
  fg,
  rightSlot,
}: {
  title: string;
  subtitle: string;
  initials: string;
  bg: string;
  fg: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 500, fontSize: 13, color: fg }}>
          {initials}
        </div>
        <div>
          <p style={{ fontWeight: 500, fontSize: 14, margin: 0 }}>{title}</p>
          <p style={{ fontSize: 12, color: colors.textSecondary, margin: 0 }}>{subtitle}</p>
        </div>
      </div>
      {rightSlot}
    </div>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: "1.5rem" }}>
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 13, fontWeight: 500, color: colors.textSecondary, margin: "1.5rem 0 8px" }}>{children}</p>
  );
}

export function Row({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderBottom: `0.5px solid ${colors.border}`, cursor: onClick ? "pointer" : "default" }}
    >
      {children}
    </div>
  );
}
