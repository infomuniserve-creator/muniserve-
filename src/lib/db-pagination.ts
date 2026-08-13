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
 */
export async function fetchAllRows<T>(
  // PromiseLike, not Promise -- supabase-js's query builders are
  // thenable but aren't real Promise instances (no .catch/.finally), so
  // a Promise-typed parameter rejects them at the call site.
  page: (offset: number, limit: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const rows: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await page(offset, PAGE_SIZE);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}
