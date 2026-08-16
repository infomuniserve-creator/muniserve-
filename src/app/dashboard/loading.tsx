/**
 * Shown instantly by Next.js while a /dashboard/* route's Server
 * Component data-fetch is in flight -- without this, clicking the
 * Applications/Businesses nav tab looked unresponsive for the ~few
 * hundred ms it takes the new page to fetch and render, since nothing
 * changed on screen until it was fully ready. Roughly traces the shape
 * of the real page (top bar, stat grid, list of cards) so the swap-in
 * feels like a continuation rather than a jolt.
 */
export default function DashboardLoading() {
  return (
    <div className="animate-pulse motion-reduce:animate-none">
      <div className="mb-8 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[104px] rounded-3xl bg-surface-2" />
        ))}
      </div>
      <div className="mb-3.5 h-5 w-40 rounded-lg bg-surface-2" />
      <div className="flex flex-col gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-40 rounded-3xl bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
