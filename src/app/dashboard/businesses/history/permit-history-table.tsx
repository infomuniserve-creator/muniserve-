"use client";

import { useMemo, useState } from "react";
import { StatCard, StatGrid, TonePill } from "../../ui";

/**
 * The dense, filterable/sortable historical permit table -- built to the
 * exact reference design the project owner shared (colors, layout, data,
 * filters, stats, badges, CSV export), reimplemented as a client
 * component instead of the reference's vanilla JS, and using our design
 * tokens (not literal hex values) so the dashboard's light/dark toggle
 * still works on this page. See CLAUDE.md for the full write-up,
 * including why this is deliberately a different visual register (dense,
 * small-radius, data-table) from the softer card-based Directory right
 * next to it -- a reporting/audit view has different needs than a
 * workflow queue, and the project owner asked for this look specifically.
 *
 * Loads every row up front (like the reference did, embedding its whole
 * dataset in the page) and does all filtering/sorting/pagination in
 * memory -- at low tens of thousands of rows this is simpler and faster
 * than round-tripping the server per interaction, same tradeoff the
 * reference made.
 */

export type PermitRow = {
  id: string;
  year: number;
  permitNo: string | null;
  businessName: string;
  ownerName: string | null;
  barangay: string | null;
  applicationType: "new" | "renewal" | null;
  category: string | null;
  description: string | null;
  ownerType: string | null;
  gender: "Male" | "Female" | null;
  amountPaid: number | null;
  capital: number | null;
  grossSales: number | null;
  payFrequency: string | null;
  legacyLicenseNo: string | null;
};

type SortKey = keyof PermitRow;
type CapBracket = "" | "unknown" | "micro" | "small" | "medium" | "large";

const PAGE_SIZE = 50;

const CAP_LABELS: Record<Exclude<CapBracket, "">, string> = {
  unknown: "Unknown",
  micro: "Micro (<₱3M)",
  small: "Small (₱3M–₱15M)",
  medium: "Medium (₱15M–₱100M)",
  large: "Large (>₱100M)",
};

function capBracket(cap: number | null): Exclude<CapBracket, ""> {
  if (!cap || cap <= 0) return "unknown";
  if (cap < 3_000_000) return "micro";
  if (cap <= 15_000_000) return "small";
  if (cap <= 100_000_000) return "medium";
  return "large";
}

function fmtShort(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return Math.round(n).toLocaleString();
}

function peso(n: number | null): string {
  if (!n) return "—";
  return "₱" + n.toLocaleString();
}

const COLUMNS: { key: SortKey; label: string; sticky?: boolean; sortable?: boolean }[] = [
  { key: "year", label: "Year", sticky: true, sortable: true },
  { key: "permitNo", label: "Permit No.", sticky: true, sortable: true },
  { key: "businessName", label: "Business Name", sticky: true, sortable: true },
  { key: "ownerName", label: "Owner", sortable: true },
  { key: "barangay", label: "Barangay", sortable: true },
  { key: "applicationType", label: "Type", sortable: true },
  { key: "category", label: "Category", sortable: true },
  { key: "description", label: "Description" },
  { key: "ownerType", label: "Owner Type", sortable: true },
  { key: "gender", label: "Gender", sortable: true },
  { key: "amountPaid", label: "Paid (₱)", sortable: true },
  { key: "capital", label: "Capital (₱)", sortable: true },
  { key: "grossSales", label: "Gross Sales (₱)", sortable: true },
  { key: "payFrequency", label: "Pay Freq.", sortable: true },
];

/**
 * Fixed pixel widths for the 3 frozen/sticky columns (Year, Permit No.,
 * Business Name) -- STICKY_LEFT is derived from these, not guessed
 * independently. A previous version hardcoded STICKY_LEFT as [0, 96, 224]
 * without ever giving those columns a matching fixed width, so the
 * columns' real (auto-computed) widths didn't line up with the assumed
 * offsets -- once scrolled, the frozen "Business Name" column silently
 * overlapped and hid the left portion of the (non-sticky) "Owner" column
 * right after it, which read as the owner name being cut off (reported by
 * the project owner, 2026-08-16). Giving each sticky column an explicit,
 * enforced width (not just max-width) and deriving STICKY_LEFT as their
 * running total makes the offsets correct by construction -- there's now
 * only one place to change a width, and the two numbers can't drift apart.
 */
const STICKY_COL_WIDTHS = [90, 130, 220]; // Year, Permit No., Business Name
const STICKY_LEFT = [0, STICKY_COL_WIDTHS[0], STICKY_COL_WIDTHS[0] + STICKY_COL_WIDTHS[1]];

export function PermitHistoryTable({ rows }: { rows: PermitRow[] }) {
  const [search, setSearch] = useState("");
  const [year, setYear] = useState("");
  const [type, setType] = useState("");
  const [barangay, setBarangay] = useState("");
  const [category, setCategory] = useState("");
  const [ownerType, setOwnerType] = useState("");
  const [gender, setGender] = useState("");
  const [payFreq, setPayFreq] = useState("");
  const [cap, setCap] = useState<CapBracket>("");
  const [sortCol, setSortCol] = useState<SortKey>("year");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [page, setPage] = useState(1);

  const options = useMemo(() => {
    const uniq = (vals: (string | null)[]) => [...new Set(vals.filter((v): v is string => Boolean(v)))].sort();
    return {
      years: [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a),
      barangays: uniq(rows.map((r) => r.barangay)),
      categories: uniq(rows.map((r) => r.category)),
      ownerTypes: uniq(rows.map((r) => r.ownerType)),
      payFreqs: uniq(rows.map((r) => r.payFrequency)),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (year && String(r.year) !== year) return false;
      if (type && r.applicationType !== type) return false;
      if (barangay && r.barangay !== barangay) return false;
      if (category && r.category !== category) return false;
      if (ownerType && r.ownerType !== ownerType) return false;
      if (gender && r.gender !== gender) return false;
      if (payFreq && r.payFrequency !== payFreq) return false;
      if (cap && capBracket(r.capital) !== cap) return false;
      if (q) {
        const hay = `${r.permitNo ?? ""} ${r.businessName} ${r.ownerName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      let av = a[sortCol];
      let bv = b[sortCol];
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -sortDir;
      if (av > bv) return sortDir;
      return 0;
    });
    return list;
  }, [rows, search, year, type, barangay, category, ownerType, gender, payFreq, cap, sortCol, sortDir]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const newCount = filtered.filter((r) => r.applicationType === "new").length;
    const renCount = filtered.filter((r) => r.applicationType === "renewal").length;
    const totalPaid = filtered.reduce((s, r) => s + (r.amountPaid || 0), 0);
    const male = filtered.filter((r) => r.gender === "Male").length;
    const female = filtered.filter((r) => r.gender === "Female").length;
    return { total, newCount, renCount, totalPaid, male, female };
  }, [filtered]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pages);
  const slice = filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  function resetToPage1() {
    setPage(1);
  }

  function clearFilters() {
    setSearch("");
    setYear("");
    setType("");
    setBarangay("");
    setCategory("");
    setOwnerType("");
    setGender("");
    setPayFreq("");
    setCap("");
    setPage(1);
  }

  function sortBy(col: SortKey) {
    if (sortCol === col) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortCol(col);
      setSortDir(1);
    }
  }

  function exportCSV() {
    const headers = ["Year", "Permit No.", "Business Name", "Owner", "Barangay", "Type", "Category", "Description", "Owner Type", "Gender", "Amount Paid", "Capitalization", "Capital Size (MSME)", "Gross Sales", "Pay Frequency", "License No."];
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = [headers.join(",")];
    for (const r of filtered) {
      lines.push([
        r.year,
        r.permitNo ?? "",
        esc(r.businessName ?? ""),
        esc(r.ownerName ?? ""),
        r.barangay ?? "",
        r.applicationType === "new" ? "New" : r.applicationType === "renewal" ? "Renewal" : "",
        r.category ?? "",
        esc(r.description ?? ""),
        r.ownerType ?? "",
        r.gender ?? "",
        r.amountPaid ?? 0,
        r.capital ?? 0,
        CAP_LABELS[capBracket(r.capital)],
        r.grossSales ?? 0,
        r.payFrequency ?? "",
        r.legacyLicenseNo ?? "",
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `BPLO_Permits_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const selectCls = "h-8 rounded-md border border-border-strong bg-surface px-2 text-[12px] text-ink";
  const labelCls = "mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-ink-faint";

  return (
    <div>
      {/* Header bar -- the reference's navy gradient header, kept as a
          literal gradient (not the shared brand-navy token alone) since
          it's this page's own identity block, matching what was asked
          for pixel-for-pixel. */}
      <div className="mb-5 flex items-center gap-3.5 rounded-2xl bg-gradient-to-br from-brand-navy to-brand-teal px-5 py-3.5 text-white shadow-[0_2px_8px_rgba(0,0,0,0.2)]">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/95">
          <svg viewBox="0 0 32 32" fill="none" className="size-6">
            <path d="M16 6L7 11v10l9 5 9-5V11L16 6z" stroke="var(--color-brand-navy)" strokeWidth="1.5" fill="none" />
            <path d="M16 6v16M7 11l9 5 9-5" stroke="var(--color-brand-navy)" strokeWidth="1.2" opacity=".6" />
          </svg>
        </div>
        <div>
          <h1 className="text-[15px] font-bold tracking-wide">BPLO Business Permit Registry</h1>
          <p className="mt-0.5 text-[11.5px] opacity-90">
            Permit History &middot; {options.years.length > 0 ? `${Math.min(...options.years)}–${Math.max(...options.years)}` : "no records yet"}
          </p>
        </div>
      </div>

      <StatGrid>
        <StatCard label="Total Permits" value={stats.total.toLocaleString()} tone="neutral" />
        <StatCard label="New Applications" value={stats.newCount.toLocaleString()} tone="info" />
        <StatCard label="Renewals" value={stats.renCount.toLocaleString()} tone="good" />
        <StatCard label="Total Amount Paid" value={"₱" + fmtShort(stats.totalPaid)} tone="warn" />
        <StatCard label="Male Owners" value={stats.male.toLocaleString()} tone="male" />
        <StatCard label="Female Owners" value={stats.female.toLocaleString()} tone="female" />
      </StatGrid>

      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-end gap-2.5 rounded-2xl border border-border bg-surface p-3.5">
        <div>
          <label className={labelCls}>Search</label>
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetToPage1(); }}
            placeholder="Business name, owner, or permit no."
            className="h-8 w-56 rounded-md border border-border-strong bg-surface px-2.5 text-[12px] text-ink placeholder:text-ink-faint"
          />
        </div>
        <div>
          <label className={labelCls}>Year</label>
          <select value={year} onChange={(e) => { setYear(e.target.value); resetToPage1(); }} className={selectCls}>
            <option value="">All Years</option>
            {options.years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Type</label>
          <select value={type} onChange={(e) => { setType(e.target.value); resetToPage1(); }} className={selectCls}>
            <option value="">All Types</option>
            <option value="new">New</option>
            <option value="renewal">Renewal</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Barangay</label>
          <select value={barangay} onChange={(e) => { setBarangay(e.target.value); resetToPage1(); }} className={selectCls}>
            <option value="">All Barangays</option>
            {options.barangays.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Category</label>
          <select value={category} onChange={(e) => { setCategory(e.target.value); resetToPage1(); }} className={selectCls}>
            <option value="">All Categories</option>
            {options.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Owner Type</label>
          <select value={ownerType} onChange={(e) => { setOwnerType(e.target.value); resetToPage1(); }} className={selectCls}>
            <option value="">All Types</option>
            {options.ownerTypes.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Gender</label>
          <select value={gender} onChange={(e) => { setGender(e.target.value); resetToPage1(); }} className={selectCls}>
            <option value="">All Genders</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Pay Frequency</label>
          <select value={payFreq} onChange={(e) => { setPayFreq(e.target.value); resetToPage1(); }} className={selectCls}>
            <option value="">All Frequencies</option>
            {options.payFreqs.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Capital Size (MSME)</label>
          <select value={cap} onChange={(e) => { setCap(e.target.value as CapBracket); resetToPage1(); }} className={selectCls}>
            <option value="">All Sizes</option>
            {(Object.keys(CAP_LABELS) as Exclude<CapBracket, "">[]).map((k) => <option key={k} value={k}>{CAP_LABELS[k]}</option>)}
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={clearFilters} className="h-8 rounded-md bg-surface-2 px-3 text-[12px] font-bold text-ink-soft hover:bg-surface-3">Clear</button>
          <button type="button" onClick={exportCSV} className="h-8 rounded-md bg-brand-navy px-3 text-[12px] font-bold text-white hover:opacity-90">&darr; Export CSV</button>
        </div>
      </div>

      {/* Table */}
      <div className="mb-3 max-h-[560px] overflow-auto rounded-2xl border border-border bg-surface">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-brand-navy text-white">
              {COLUMNS.map((col, i) => (
                // tabIndex/onKeyDown/aria-sort -- sorting only responded to a mouse click
                // before (2026-08-20 audit finding), with no keyboard equivalent and no
                // aria-sort for a screen reader to announce the current sort state.
                <th
                  key={col.key}
                  onClick={col.sortable ? () => sortBy(col.key) : undefined}
                  onKeyDown={
                    col.sortable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            sortBy(col.key);
                          }
                        }
                      : undefined
                  }
                  tabIndex={col.sortable ? 0 : undefined}
                  role={col.sortable ? "button" : undefined}
                  aria-sort={col.sortable ? (sortCol === col.key ? (sortDir === 1 ? "ascending" : "descending") : "none") : undefined}
                  className={`truncate px-3 py-2.5 text-left text-[11px] font-bold tracking-wide ${col.sortable ? "cursor-pointer hover:bg-brand-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-white focus-visible:-outline-offset-2" : ""} ${col.sticky ? "sticky z-[3] bg-brand-navy" : ""}`}
                  style={col.sticky ? { left: STICKY_LEFT[i], width: STICKY_COL_WIDTHS[i], minWidth: STICKY_COL_WIDTHS[i], maxWidth: STICKY_COL_WIDTHS[i] } : undefined}
                >
                  {col.label}
                  {sortCol === col.key && (sortDir === 1 ? " ▲" : " ▼")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="p-8 text-center text-ink-faint">No records match the current filters.</td>
              </tr>
            ) : (
              slice.map((r) => (
                <tr key={r.id} className="group border-b border-border last:border-b-0 hover:bg-info-bg">
                  <td
                    className="sticky z-[2] truncate bg-surface px-3 py-2 tabular-nums group-hover:bg-info-bg"
                    style={{ left: STICKY_LEFT[0], width: STICKY_COL_WIDTHS[0], minWidth: STICKY_COL_WIDTHS[0], maxWidth: STICKY_COL_WIDTHS[0] }}
                  >
                    {r.year}
                  </td>
                  <td
                    className="sticky z-[2] truncate bg-surface px-3 py-2 group-hover:bg-info-bg"
                    style={{ left: STICKY_LEFT[1], width: STICKY_COL_WIDTHS[1], minWidth: STICKY_COL_WIDTHS[1], maxWidth: STICKY_COL_WIDTHS[1] }}
                  >
                    {r.permitNo ?? "—"}
                  </td>
                  <td
                    className="sticky z-[2] truncate bg-surface px-3 py-2 font-bold text-ink group-hover:bg-info-bg"
                    style={{ left: STICKY_LEFT[2], width: STICKY_COL_WIDTHS[2], minWidth: STICKY_COL_WIDTHS[2], maxWidth: STICKY_COL_WIDTHS[2] }}
                  >
                    {r.businessName}
                  </td>
                  <td className="max-w-[180px] truncate px-3 py-2">{r.ownerName ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{r.barangay ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.applicationType === "new" ? <TonePill label="New" tone="info" /> : r.applicationType === "renewal" ? <TonePill label="Renewal" tone="good" /> : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{r.category ?? "—"}</td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-ink-soft">{r.description ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{r.ownerType ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.gender === "Male" ? <span className="font-bold text-male">&#9794; Male</span> : r.gender === "Female" ? <span className="font-bold text-female">&#9792; Female</span> : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-bold tabular-nums text-brand-navy">{peso(r.amountPaid)}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-bold tabular-nums text-brand-navy">{peso(r.capital)}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-bold tabular-nums text-brand-navy">{peso(r.grossSales)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{r.payFrequency ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pager */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-2.5">
        <span className="text-[11.5px] text-ink-faint">
          Showing {filtered.length === 0 ? 0 : (clampedPage - 1) * PAGE_SIZE + 1}
          {"–"}
          {Math.min(clampedPage * PAGE_SIZE, filtered.length)} of {filtered.length.toLocaleString()} records
        </span>
        <div className="flex items-center gap-1">
          <PagerButton onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={clampedPage <= 1} label="Previous page">&lsaquo;</PagerButton>
          <PageButtons page={clampedPage} pages={pages} onGo={setPage} />
          <PagerButton onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={clampedPage >= pages} label="Next page">&rsaquo;</PagerButton>
        </div>
      </div>
    </div>
  );
}

function PagerButton({ children, onClick, disabled, active, label }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; active?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`h-7 min-w-7 rounded-md border px-2 text-[12px] transition-colors ${
        active ? "border-brand-navy bg-brand-navy font-bold text-white" : "border-border text-ink-soft hover:bg-surface-2"
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function PageButtons({ page, pages, onGo }: { page: number; pages: number; onGo: (p: number) => void }) {
  const lo = Math.max(1, page - 3);
  const hi = Math.min(pages, page + 3);
  const items: (number | "...")[] = [];
  if (lo > 1) { items.push(1); if (lo > 2) items.push("..."); }
  for (let i = lo; i <= hi; i++) items.push(i);
  if (hi < pages) { if (hi < pages - 1) items.push("..."); items.push(pages); }
  return (
    <>
      {items.map((it, i) =>
        it === "..." ? (
          <span key={`e${i}`} className="px-1 text-[12px] text-ink-faint">&hellip;</span>
        ) : (
          <PagerButton key={it} onClick={() => onGo(it)} active={it === page}>{it}</PagerButton>
        )
      )}
    </>
  );
}
