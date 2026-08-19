import { getCurrentStaff } from "@/lib/staff";
import { BUSINESS_PROFILE_COLUMNS, mapBusinessProfile } from "@/lib/business-profile";
import { classifyBusinessStatus, BUSINESS_STATUS_LABEL, BUSINESS_STATUS_TONE, type BusinessStatus } from "@/lib/business-status";
import { getLbtCategoryOptions, type LbtCategoryOption } from "@/lib/lbt-categories";
import { fetchAllRows } from "@/lib/db-pagination";
import { maskPhone } from "@/lib/mask";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  BuildingIcon, ChevronRightIcon, ClockIcon, EmptyState, InfoIcon, BusinessProfileBlock,
  MiniButton, PrimaryButton, SearchIcon, StatCard, StatGrid, TonePill, XIcon,
} from "../ui";
import { BusinessesSubNav } from "./sub-nav";
import { claimLegacyBusiness, regeneratePermitPdf, setLbtCategory, startWalkInApplication, unclaimBusiness, updateOwnerPhone } from "./actions";

const STATUS_FILTERS: { value: "all" | BusinessStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: BUSINESS_STATUS_LABEL.active },
  { value: "needs_renewal", label: BUSINESS_STATUS_LABEL.needs_renewal },
  { value: "in_progress", label: BUSINESS_STATUS_LABEL.in_progress },
  { value: "legacy", label: BUSINESS_STATUS_LABEL.legacy },
  { value: "inactive", label: BUSINESS_STATUS_LABEL.inactive },
];

const APP_STATUS_LABEL: Record<string, string> = {
  submitted: "Submitted",
  pending_bplo_initial: "Pending BPLO review",
  pending_dept_review: "In department review",
  returned_to_applicant: "Returned to applicant",
  pending_bplo_assessment: "Pending assessment",
  pending_payment: "Pending payment",
  pending_printing: "Pending printing",
  pending_mayor: "Pending mayor's signature",
  pending_release: "Pending release",
  released: "Released",
  rejected: "Rejected",
  archived: "Archived (not proceeding)",
};

const DISPLAY_CAP = 60;

/**
 * Business Registry -- every business on file, not just the ones with an
 * application currently in flight (that's what the Applications tab is
 * for). Available to every staff role read-only (RLS's existing "staff
 * can view businesses/applications at their own lgu" policies from
 * migration 0002 already cover this -- no new policy needed for reading);
 * only BPLO gets the walk-in "start on their behalf" action, per the
 * design discussion's scope decision.
 *
 * Search/status filtering happens server-side via plain GET query params
 * -- no client JS, consistent with the rest of this app's Server
 * Component + native-form approach. At pilot scale (~1,200 businesses)
 * fetching the full set and filtering/classifying in memory is simpler
 * and plenty fast; the display itself is capped (DISPLAY_CAP) with an
 * explicit "showing X of Y" count rather than silently truncating.
 */
export default async function BusinessesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  const { q: rawQ, status: rawStatus } = await searchParams;
  const q = (rawQ ?? "").trim();
  const statusFilter = (STATUS_FILTERS.some((f) => f.value === rawStatus) ? rawStatus : "all") as "all" | BusinessStatus;

  const supabase = await createClient();
  const lbtCategoryOptions = staff.role === "bplo" ? await getLbtCategoryOptions(staff.lgu_id) : [];

  // San Miguel alone already has 1,177 businesses -- more than PostgREST's
  // silent 1,000-row default cap, which under-populated this exact page
  // before this fix (see db-pagination.ts and CLAUDE.md for how that was
  // caught). applications/permits are far smaller today but get the same
  // treatment so this can't quietly recur as they grow.
  const [businesses, applications, permits] = await Promise.all([
    fetchAllRows((offset, limit) =>
      supabase
        .from("businesses")
        .select(`${BUSINESS_PROFILE_COLUMNS}, address, legacy_license_no, is_active, is_legacy_unclaimed, owner_id, created_at, owner:owners(full_name, phone)`, { count: "exact" })
        .eq("lgu_id", staff.lgu_id)
        .order("business_name", { ascending: true })
        .range(offset, offset + limit - 1)
    ),
    fetchAllRows((offset, limit) =>
      supabase
        .from("applications")
        .select("id, business_id, status, application_type, application_year, reference_number, submitted_at, assessment_finalized_at", { count: "exact" })
        .eq("lgu_id", staff.lgu_id)
        .range(offset, offset + limit - 1)
    ),
    fetchAllRows((offset, limit) =>
      supabase
        .from("permits")
        .select("valid_until, application:applications!inner(business_id, lgu_id)", { count: "exact" })
        .eq("application.lgu_id", staff.lgu_id)
        .range(offset, offset + limit - 1)
    ),
  ]);

  type AppRow = {
    id: string;
    business_id: string;
    status: string;
    application_type: string;
    application_year: number | null;
    reference_number: string | null;
    submitted_at: string;
    assessment_finalized_at: string | null;
  };
  const appRows = (applications ?? []) as unknown as AppRow[];
  const appsByBusiness = new Map<string, AppRow[]>();
  for (const a of appRows) {
    const list = appsByBusiness.get(a.business_id) ?? [];
    list.push(a);
    appsByBusiness.set(a.business_id, list);
  }

  type PermitRow = { valid_until: string | null; application: { business_id: string } | null };
  const permitRows = (permits ?? []) as unknown as PermitRow[];
  const latestPermitByBusiness = new Map<string, string>();
  for (const p of permitRows) {
    const businessId = p.application?.business_id;
    if (!businessId || !p.valid_until) continue;
    const existing = latestPermitByBusiness.get(businessId);
    if (!existing || p.valid_until > existing) latestPermitByBusiness.set(businessId, p.valid_until);
  }

  const today = new Date();

  const classified = (businesses ?? []).map((raw) => {
    const b = raw as unknown as BizRowType;
    const apps = appsByBusiness.get(b.id) ?? [];
    const status = classifyBusinessStatus({
      isLegacyUnclaimed: b.is_legacy_unclaimed,
      isActive: b.is_active,
      applicationStatuses: apps.map((a) => a.status),
      latestPermitValidUntil: latestPermitByBusiness.get(b.id) ?? null,
      today,
    });
    return { business: b, status, apps: apps.sort((a, c) => (a.submitted_at < c.submitted_at ? 1 : -1)) };
  });

  const counts: Record<BusinessStatus, number> = { active: 0, needs_renewal: 0, legacy: 0, inactive: 0, in_progress: 0 };
  for (const c of classified) counts[c.status]++;

  const searchLower = q.toLowerCase();
  const filtered = classified.filter(({ business: b, status }) => {
    if (statusFilter !== "all" && status !== statusFilter) return false;
    if (!searchLower) return true;
    const haystack = [b.business_name, b.legacy_owner_name, b.owner?.full_name, b.legacy_license_no, b.barangay]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(searchLower);
  });

  const totalMatched = filtered.length;
  const displayed = filtered.slice(0, DISPLAY_CAP);

  const qsSuffix = q ? `&q=${encodeURIComponent(q)}` : "";

  return (
    <>
      <BusinessesSubNav active="directory" />

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-bold text-ink">Business Registry</h1>
          <p className="mt-1.5 max-w-lg text-[14px] text-ink-soft">
            Every business on file in San Miguel, Bulacan — legacy records, active permits, and everything in between.
          </p>
        </div>
        <span className="text-[12.5px] font-bold uppercase tracking-wide text-ink-faint">{classified.length.toLocaleString()} businesses on file</span>
      </div>

      <StatGrid>
        <StatCard label={BUSINESS_STATUS_LABEL.active} value={counts.active} icon={<StatusIcon status="active" />} tone="good" />
        <StatCard label={BUSINESS_STATUS_LABEL.needs_renewal} value={counts.needs_renewal} icon={<StatusIcon status="needs_renewal" />} tone="warn" />
        <StatCard label={BUSINESS_STATUS_LABEL.legacy} value={counts.legacy} icon={<StatusIcon status="legacy" />} tone="info" />
        <StatCard label={BUSINESS_STATUS_LABEL.inactive} value={counts.inactive} icon={<StatusIcon status="inactive" />} tone="neutral" />
      </StatGrid>

      <form action="/dashboard/businesses" method="get" className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <input type="hidden" name="status" value={statusFilter} />
        <div className="flex min-w-[240px] max-w-sm flex-1 items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <SearchIcon className="size-4 text-ink-faint" />
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search by business name, owner, or license no."
            className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
          />
        </div>
        <button type="submit" className="rounded-full border border-border-strong px-4 py-2.5 text-[12.5px] font-bold text-ink-soft hover:bg-surface-2">
          Search
        </button>
      </form>

      <div className="mb-3.5 flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={`/dashboard/businesses?status=${f.value}${qsSuffix}`}
            className={`rounded-full px-3.5 py-2 text-[12.5px] font-bold transition-colors ${
              statusFilter === f.value ? "bg-brand-navy text-white" : "border border-border bg-surface text-ink-soft hover:border-border-strong"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <p className="mb-3 text-[12.5px] text-ink-faint">
        Showing {displayed.length.toLocaleString()} of {totalMatched.toLocaleString()} businesses
        {totalMatched > DISPLAY_CAP && " — refine your search to narrow this down"}
      </p>

      {displayed.length === 0 ? (
        <EmptyState>No businesses match that search.</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-border bg-surface shadow-[0_1px_2px_rgba(23,33,66,0.05),0_10px_28px_-12px_rgba(23,33,66,0.14)]">
          {displayed.map(({ business: b, status, apps }) => (
            <RegistryRow
              key={b.id}
              business={b}
              status={status}
              apps={apps}
              validUntil={latestPermitByBusiness.get(b.id) ?? null}
              canWalkIn={staff.role === "bplo"}
              lbtCategoryOptions={lbtCategoryOptions}
            />
          ))}
        </div>
      )}
    </>
  );
}

function StatusIcon({ status }: { status: BusinessStatus }) {
  if (status === "active") return <PrimaryCheckIcon />;
  if (status === "needs_renewal") return <ClockIcon />;
  if (status === "legacy") return <BuildingIcon />;
  return <XIcon />;
}
function PrimaryCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="size-4">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

type BizRowType = Record<string, unknown> & {
  id: string;
  business_name: string;
  legacy_owner_name: string | null;
  legacy_license_no: string | null;
  is_active: boolean;
  is_legacy_unclaimed: boolean;
  owner_id: string | null;
  created_at: string;
  barangay: string | null;
  nature_of_business: string | null;
  address: string | null;
  owner: { full_name: string; phone: string } | null;
};
type AppRowType = {
  id: string;
  status: string;
  application_type: string;
  application_year: number | null;
  reference_number: string | null;
  submitted_at: string;
  assessment_finalized_at: string | null;
};

function ownerLabel(b: BizRowType): string {
  if (b.owner?.full_name) return b.owner.full_name;
  if (b.legacy_owner_name) {
    const initials = b.legacy_owner_name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("·").toUpperCase();
    return `${initials} (owner not yet on MuniServe)`;
  }
  return "Unknown owner";
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function RegistryRow({
  business: b, status, apps, validUntil, canWalkIn, lbtCategoryOptions,
}: {
  business: BizRowType; status: BusinessStatus; apps: AppRowType[]; validUntil: string | null; canWalkIn: boolean;
  lbtCategoryOptions: LbtCategoryOption[];
}) {
  const profile = mapBusinessProfile(b);
  const dateLabel =
    status === "legacy"
      ? `On file since ${new Date(b.created_at).getFullYear()}`
      : status === "active" && validUntil
        ? `Valid through ${formatDate(validUntil)}`
        : status === "needs_renewal" && validUntil
          ? `Expired ${formatDate(validUntil)}`
          : "";

  const walkInType: "new" | "renewal" = status === "inactive" ? "new" : "renewal";
  const amountLabel = walkInType === "new" ? "Capital investment (₱)" : "Gross sales, preceding year (₱)";
  const buttonLabel =
    walkInType === "new"
      ? "Start a new application for this business"
      : status === "legacy"
        ? "Start renewal on their behalf"
        : "Start renewal for this business";

  return (
    <details className="border-b border-border last:border-b-0">
      <summary className="flex cursor-pointer items-center gap-3 px-4.5 py-3.5 transition-colors hover:bg-surface-2">
        <span className={`size-2.5 shrink-0 rounded-full ${DOT_CLASS[status]}`} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-bold text-ink">{b.business_name}</div>
          <div className="truncate text-[12px] text-ink-soft">
            {ownerLabel(b)} · {b.barangay ?? "—"} · {b.nature_of_business ?? "—"}
          </div>
        </div>
        <TonePill label={BUSINESS_STATUS_LABEL[status]} tone={BUSINESS_STATUS_TONE[status]} />
        <span className="hidden w-28 shrink-0 text-right text-[11.5px] text-ink-faint sm:block">{dateLabel}</span>
        <span className="hidden shrink-0 items-center gap-1 text-[11.5px] font-bold text-brand-navy sm:flex">
          View details
          <ChevronRightIcon className="chev size-3.5 shrink-0" />
        </span>
        <ChevronRightIcon className="chev size-3.5 shrink-0 text-ink-faint sm:hidden" />
      </summary>

      <div className="px-4.5 pb-4.5">
        {status === "legacy" && (
          <div className="mb-3.5 flex items-start gap-2 rounded-2xl bg-surface-3 px-3.5 py-3 text-[12.5px] text-ink-soft">
            <InfoIcon className="mt-0.5 size-4 shrink-0 text-ink-faint" />
            Imported from the old paper roster. No owner has claimed this business on MuniServe yet — it has no phone
            number on file, so it can&rsquo;t be looked up by SMS. If the owner is renewing in person, start it below instead.
          </div>
        )}

        <BusinessProfileBlock legacyAddress={b.address} profile={profile} applicationType="renewal" basisAmount={profile.grossSales} />

        {canWalkIn && (
          <form action={setLbtCategory} className="mb-3.5 flex flex-wrap items-center gap-2">
            <label className="text-[11.5px] font-bold text-ink-soft">LBT category:</label>
            <input type="hidden" name="businessId" value={b.id} />
            <select
              name="lbtCategory"
              defaultValue={profile.lbtCategory ?? ""}
              className="rounded-xl border border-border-strong bg-surface px-2.5 py-1.5 text-[12.5px] text-ink"
            >
              <option value="">— not set —</option>
              {lbtCategoryOptions.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <MiniButton type="submit">Save</MiniButton>
            <Link href="/dashboard/settings" className="text-[11px] font-bold text-info-ink underline underline-offset-2">
              Don&rsquo;t see it? Add it in Settings
            </Link>
            {!profile.lbtCategory && (
              <span className="text-[11.5px] font-bold text-warn-ink">
                Required before this business&apos;s application can enter department review or be assessed.
              </span>
            )}
          </form>
        )}

        {b.legacy_license_no && (
          <p className="mb-3 text-[12.5px] text-ink-soft">
            <span className="font-bold text-ink-faint">License no.</span> {b.legacy_license_no}
          </p>
        )}

        {canWalkIn && (
          b.owner_id ? (
            <div className="mb-3.5 flex flex-wrap items-center gap-2 rounded-2xl bg-surface-2 p-3">
              <form action={updateOwnerPhone} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="businessId" value={b.id} />
                <span className="text-[11.5px] font-bold text-ink-soft">
                  Registered phone: {b.owner?.phone ? maskPhone(b.owner.phone) : "—"}
                </span>
                <input
                  name="newPhone"
                  type="tel"
                  placeholder="New mobile no. (verify in person first)"
                  className="h-8 w-56 rounded-lg border border-border-strong bg-surface px-2.5 text-[12px] text-ink placeholder:text-ink-faint"
                />
                <MiniButton type="submit" tone="neutral">Update</MiniButton>
              </form>
              <form action={unclaimBusiness}>
                <input type="hidden" name="businessId" value={b.id} />
                <MiniButton type="submit" tone="bad">Unlink owner</MiniButton>
              </form>
            </div>
          ) : (
            <form action={claimLegacyBusiness} className="mb-3.5 flex flex-wrap items-center gap-2 rounded-2xl bg-surface-2 p-3">
              <input type="hidden" name="businessId" value={b.id} />
              <span className="text-[11.5px] font-bold text-ink-soft">No account linked yet.</span>
              <input
                name="phone"
                type="tel"
                placeholder="Mobile no. (verify in person first)"
                className="h-8 w-56 rounded-lg border border-border-strong bg-surface px-2.5 text-[12px] text-ink placeholder:text-ink-faint"
              />
              <MiniButton type="submit" tone="neutral">Attach number</MiniButton>
              <span className="text-[11px] text-ink-faint">Doesn&rsquo;t file anything — just links their account for next time.</span>
            </form>
          )
        )}

        {apps.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-faint">Application history</p>
            <div className="flex flex-col">
              {apps.map((a) => (
                <div key={a.id} className="flex items-center gap-3 border-b border-border py-2 text-[12.5px] last:border-b-0">
                  <span className="w-32 shrink-0 font-bold tabular-nums text-ink">{a.reference_number ?? "—"}</span>
                  <span className="w-11 shrink-0 text-ink-faint tabular-nums">{a.application_year ?? "—"}</span>
                  <span className="min-w-0 flex-1 text-ink-soft">
                    {a.application_type === "new" ? "New" : "Renewal"} · {APP_STATUS_LABEL[a.status] ?? a.status}
                  </span>
                  <a
                    href={`/api/dashboard/application-form-pdf?applicationId=${a.id}`}
                    className="shrink-0 text-[11.5px] font-bold text-info-ink underline underline-offset-2"
                  >
                    Submitted form (PDF)
                  </a>
                  {a.assessment_finalized_at && (
                    <a
                      href={`/api/dashboard/order-of-payment?applicationId=${a.id}`}
                      className="shrink-0 text-[11.5px] font-bold text-info-ink underline underline-offset-2"
                    >
                      Order of Payment
                    </a>
                  )}
                  {canWalkIn && (a.status === "pending_release" || a.status === "released") && (
                    <form action={regeneratePermitPdf} className="shrink-0">
                      <input type="hidden" name="applicationId" value={a.id} />
                      <MiniButton type="submit" tone="neutral">Regenerate permit PDF</MiniButton>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {canWalkIn && status === "in_progress" && (
          <p className="text-[12.5px] text-ink-soft">
            This business has an application currently in progress — see the{" "}
            <Link href="/dashboard/bplo" className="font-bold text-brand-navy">Applications</Link> tab.
          </p>
        )}

        {canWalkIn && status !== "in_progress" && (
          <form action={startWalkInApplication} className="flex flex-wrap items-end gap-2.5 rounded-2xl bg-surface-2 p-4">
            <input type="hidden" name="businessId" value={b.id} />
            <input type="hidden" name="applicationType" value={walkInType} />
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">{amountLabel}</label>
              <input name="amount" type="number" step="0.01" required className="h-9 w-44 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink" />
            </div>
            {!b.owner_id && (
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">Mobile no. (optional)</label>
                <input name="phone" type="tel" placeholder="09XX XXX XXXX" className="h-9 w-40 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint" />
              </div>
            )}
            <PrimaryButton type="submit" disabled={!profile.lbtCategory} title={!profile.lbtCategory ? "Set the LBT category above first" : undefined}>
              {buttonLabel}
            </PrimaryButton>
          </form>
        )}
      </div>
    </details>
  );
}

const DOT_CLASS: Record<BusinessStatus, string> = {
  active: "bg-good",
  needs_renewal: "bg-warn",
  legacy: "bg-info",
  inactive: "bg-ink-faint",
  in_progress: "bg-info",
};
