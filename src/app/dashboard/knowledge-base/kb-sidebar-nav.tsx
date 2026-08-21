"use client";

import { useMemo, useState } from "react";

export type KbNavLink = { href: string; label: string; keywords: string };
export type KbNavGroup = { title: string; links: KbNavLink[] };

/**
 * Live-filters the sidebar's own section list as you type (2026-08-21,
 * project owner's own request) -- the same instant-filter pattern this
 * codebase already established for SearchableSelect (ApplyPageClient.tsx),
 * not a second technique. Matches against each link's own label AND a
 * curated `keywords` string (terms that appear inside that section but
 * not necessarily in its short title, e.g. "FSIF" or "sign out") so a
 * search finds the right SECTION even when the exact word isn't the
 * section's own name -- the page's real text underneath still supports a
 * plain browser Ctrl+F for finding an exact sentence once you're there.
 */
export function KbSidebarNav({ groups }: { groups: KbNavGroup[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, links: g.links.filter((l) => l.label.toLowerCase().includes(q) || l.keywords.toLowerCase().includes(q)) }))
      .filter((g) => g.links.length > 0);
  }, [query, groups]);

  return (
    <div>
      <div className="relative mb-3.5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the Knowledge Base…"
          aria-label="Search the Knowledge Base"
          className="h-9 w-full rounded-xl border border-border-strong bg-surface px-3 text-[12.5px] text-ink placeholder:text-ink-faint"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-1.5 text-[13px] font-bold text-ink-faint hover:text-ink"
          >
            ×
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="px-2 py-3 text-[12px] text-ink-faint">No matches — try a different word.</p>
      ) : (
        <div className="flex flex-col gap-3.5">
          {filtered.map((group) => (
            <div key={group.title}>
              <p className="mb-1 px-2 text-[10.5px] font-extrabold uppercase tracking-wide text-ink-faint">{group.title}</p>
              {group.links.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  className="block rounded-xl px-2 py-1.5 text-[12.5px] font-bold text-ink-soft transition-colors hover:bg-info-bg hover:text-info-ink"
                >
                  {l.label}
                </a>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
