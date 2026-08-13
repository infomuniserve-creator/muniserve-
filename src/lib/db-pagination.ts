/**
 * Supabase/PostgREST caps a single response at 1,000 rows by default --
 * silently, no error, no warning. Found the hard way while importing
 * permit_history (13,548 rows): the businesses lookup used to link
 * legacy_license_no only ever saw the first 1,000 of San Miguel's 1,177
 * businesses, so ~177 rows that should have linked didn't (fixed with a
 * follow-up UPDATE once caught -- see CLAUDE.md). The Business Registry
 * Directory's own businesses query had the exact same bug already
 * shipped -- San Miguel has 1,177 businesses, so it was silently showing
 * at most 1,000 of them. Any query expected to return more than 1,000
 * rows needs this, not a bare `.select()`.
 *
 * Fetches every page IN PARALLEL, not one-at-a-time -- the first version
 * of this looped sequentially (await page 1, then await page 2, ...),
 * which is exactly why switching to Permit History felt "unusually
 * long": 13,548 rows means 14 round trips to Supabase, each one waiting
 * on the last to even start. `page` must ask for an exact count (Supabase
 * `.select(cols, { count: "exact" })`) so this knows how many pages exist
 * up front and can fire them all at once.
 */
export async function fetchAllRows<T>(
  // PromiseLike, not Promise -- supabase-js's query builders are
  // thenable but aren't real Promise instances (no .catch/.finally), so
  // a Promise-typed parameter rejects them at the call site.
  page: (offset: number, limit: number) => PromiseLike<{ data: T[] | null; error: unknown; count?: number | null }>
): Promise<T[]> {
  const PAGE_SIZE = 1000;

  const first = await page(0, PAGE_SIZE);
  if (first.error) throw first.error;
  const firstRows = first.data ?? [];

  // No count came back (caller forgot { count: "exact" }), or the whole
  // table fit in one page -- either way there's nothing left to fetch.
  if (first.count == null || firstRows.length < PAGE_SIZE) {
    return firstRows;
  }

  const remainingPages = Math.ceil(first.count / PAGE_SIZE) - 1;
  const rest = await Promise.all(
    Array.from({ length: remainingPages }, (_, i) => page((i + 1) * PAGE_SIZE, PAGE_SIZE))
  );

  const rows = [...firstRows];
  for (const r of rest) {
    if (r.error) throw r.error;
    rows.push(...(r.data ?? []));
  }
  return rows;
}
