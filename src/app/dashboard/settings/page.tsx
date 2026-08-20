import { getCurrentStaff } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { buildApplyEmbedSnippet } from "@/lib/embed";
import { createClient } from "@/lib/supabase/server";
import { EmbedCodeBox } from "@/components/embed-code-box";
import { redirect } from "next/navigation";
import { BuildingIcon, Card, CollapsibleSection, FileIcon, MiniButton, PinIcon, PrimaryButton, SettingsGroup, SettingsIcon, BellIcon, UserIcon, TonePill } from "../ui";
import { addBarangays, addRegulatoryFee, removeBarangay, setAutomatedAssessmentEnabled, setBarangayClearanceRate, setCedulaIncludedOnline, setRegulatoryFeeAcctCode, setRegulatoryFeeActive, updateBuildingPermitFeeSettings, updateInstallmentReminderDates, updateMayorName, updateSenderName, updateTreasurerName } from "./actions";
import { FeeRuleImportCard } from "./fee-rule-import";
import { StaffManagementSection } from "./staff-management";
import { PrintTemplateUpload } from "./print-template-upload";
import { BusinessImportCard } from "./business-import";
import { PermitNumberFormatCard } from "./permit-number-format";
import { PaymentMethodsCard } from "./payment-methods";
import { SmsUsageCard } from "./sms-usage-card";
import { getCurrentMonthSmsCount, SMS_FREE_MONTHLY_LIMIT } from "@/lib/sms-usage";
import type { SectionStatus } from "../ui";

/**
 * BPLO-only settings hub (CLAUDE.md section 7o follow-up). Originally
 * split out of /dashboard/staff to separate LGU-level configuration from
 * staff-account management; as of 2026-08-15, staff management moved back
 * in as this page's own first section ("Add/Remove Staff") instead of a
 * separate top-nav tab -- it's an occasional admin task, same category as
 * everything else here, not a primary day-to-day section like
 * Applications or Businesses. This page is meant to keep growing: more
 * LGU-level settings land here going forward.
 *
 * Every section is collapsed by default (2026-08-17, CollapsibleSection
 * in ui.tsx) -- eleven sections' worth of forms/cards all expanded at
 * once was the project owner's own flagged complaint ("taking a lot of
 * space"), not just Barangays/Barangay Clearance specifically.
 */
export default async function SettingsPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "bplo") redirect("/dashboard");

  const supabase = await createClient();
  const lgu = await getLguDisplay(supabase, staff.lgu_id);

  const { data: regulatoryFeesRaw } = await supabase
    .from("fee_rules")
    .select("id, name, flat_amount, delivery_mode, is_active, acct_code")
    .eq("lgu_id", staff.lgu_id)
    .eq("fee_category", "regulatory")
    .order("sort_order");
  const regulatoryFees = regulatoryFeesRaw ?? [];

  const { data: staffListRaw } = await supabase
    .from("staff_users")
    .select("id, full_name, email, phone, role, department, is_active, auth_user_id")
    .eq("lgu_id", staff.lgu_id)
    .eq("is_admin_proxy", false)
    .order("role", { ascending: true })
    .order("full_name", { ascending: true });

  const { data: departmentsRaw } = await supabase
    .from("lgu_departments")
    .select("name, display_name")
    .eq("lgu_id", staff.lgu_id)
    .eq("is_active", true)
    .order("name", { ascending: true });

  const { data: barangaysRaw } = await supabase
    .from("lgu_form_options")
    .select("id, value")
    .eq("lgu_id", staff.lgu_id)
    .eq("option_type", "barangay")
    .order("sort_order", { ascending: true });
  const barangays = barangaysRaw ?? [];

  const { data: barangayClearanceRulesRaw } = await supabase
    .from("fee_rules")
    .select("applies_to, flat_amount, acct_code")
    .eq("lgu_id", staff.lgu_id)
    .eq("fee_category", "barangay_clearance")
    .eq("is_active", true);
  const barangayClearanceByAppliesTo = new Map((barangayClearanceRulesRaw ?? []).map((r) => [r.applies_to, r]));
  const uniformBarangayClearance = barangayClearanceByAppliesTo.get("all") ?? null;
  const barangayClearanceOverrideCount = [...barangayClearanceByAppliesTo.keys()].filter((k) => k !== "all").length;

  /**
   * Status pills next to each section's title (2026-08-20, from the
   * Settings mockup the project owner asked to build for real) -- every
   * section here starts collapsed by design (CLAUDE.md 7nn), so without
   * this there was no way to tell e.g. whether Automated Assessment is on
   * without opening that one section specifically. Two small queries
   * added below (business count, active rate-rule count) purely to
   * support this -- everything else reuses data this page was already
   * fetching for the sections' own content.
   */
  const { count: businessCount } = await supabase
    .from("businesses")
    .select("id", { count: "exact", head: true })
    .eq("lgu_id", staff.lgu_id);

  const { count: activeRateRuleCount } = await supabase
    .from("fee_rules")
    .select("id", { count: "exact", head: true })
    .eq("lgu_id", staff.lgu_id)
    .in("fee_category", ["lbt", "mayors_permit"])
    .eq("is_active", true);

  const smsThisMonth = await getCurrentMonthSmsCount(supabase, staff.lgu_id);

  const activeRegulatoryFeeCount = regulatoryFees.filter((f) => f.is_active).length;

  const installmentDatesSet = lgu.lbtBiannualReminderDates.length > 0 || lgu.lbtQuarterlyReminderDates.length > 0;
  const installmentStatus: SectionStatus = installmentDatesSet
    ? { label: [lgu.lbtBiannualReminderDates.length > 0 && "Bi-Annual", lgu.lbtQuarterlyReminderDates.length > 0 && "Quarterly"].filter(Boolean).join(" + ") + " set", tone: "good" }
    : { label: "No reminder dates set", tone: "neutral" };

  const barangayClearanceStatus: SectionStatus = !uniformBarangayClearance
    ? { label: "Uniform rate not set", tone: "warn" }
    : barangayClearanceOverrideCount > 0
      ? { label: `Uniform rate + ${barangayClearanceOverrideCount} override${barangayClearanceOverrideCount === 1 ? "" : "s"}`, tone: "good" }
      : { label: "Uniform rate, no overrides", tone: "neutral" };

  // The counter's real next value lives in application_reference_counters,
  // not shown here -- this is a format preview only (matches what
  // PermitNumberFormatCard's own live preview shows), using "1" padded to
  // the configured width. The year stays live-computed from today's real
  // date, same as the real number generator.
  const previewYear = new Date().getFullYear();
  const previewYearStr = lgu.referenceYearDigits === 2 ? String(previewYear).slice(-2) : String(previewYear);
  const permitFormatPreview = `${lgu.referencePrefix}-${previewYearStr}-${"1".padStart(lgu.referenceCounterDigits, "0")}`;

  const paymentMethodLabels = [
    lgu.acceptsCashCounter && "Cash",
    lgu.acceptsGcash && "GCash",
    lgu.acceptsBankTransfer && "Bank",
    lgu.acceptsOnlinePortal && "Online",
  ].filter(Boolean) as string[];

  return (
    <>
      <div className="mb-7">
        <h1 className="font-display text-[26px] font-bold text-ink">Settings</h1>
        <p className="mt-1.5 max-w-lg text-[14px] text-ink-soft">Everything that governs how {lgu.name} runs on MuniServe -- who has access, what things cost, and what applicants and staff see.</p>
      </div>

      <SettingsGroup icon={<UserIcon className="size-4" />} title="Staff & Access" description="Who can sign in, and what they can do.">
        <StaffManagementSection lguName={lgu.name} lguProvince={lgu.province} staffList={staffListRaw ?? []} departments={departmentsRaw ?? []} />
      </SettingsGroup>

      <SettingsGroup icon={<BuildingIcon className="size-4" />} title="Data Import" description="Bring in your existing business roster from a previous system.">
        <CollapsibleSection
          title="Import Businesses"
          sub="Upload an Excel/CSV export of your businesses — turns into self-service renewals immediately for any row with a mobile number."
          status={{ label: `${(businessCount ?? 0).toLocaleString()} on file`, tone: "neutral" }}
        >
          <BusinessImportCard />
        </CollapsibleSection>
      </SettingsGroup>

      <SettingsGroup icon={<span className="text-[15px] leading-none">₱</span>} title="Fee Rates" description="How much each fee actually costs.">
      <CollapsibleSection
        title="Business Tax & Mayor's Permit Fee Setup"
        sub="Set or update your LGU's Local Business Tax and Mayor's Permit Fee rates yourself — download the current rates, edit them in Excel/Sheets, upload the file back. No developer needed. This is also where LBT categories come from: each row in the Local Business Tax file adds one category, which then shows up wherever staff pick a business's category."
        status={
          activeRateRuleCount && activeRateRuleCount > 0
            ? { label: `${activeRateRuleCount} active rates`, tone: "good" }
            : { label: "No rates set up yet", tone: "warn" }
        }
      >
        <div className="flex flex-col gap-3">
          <FeeRuleImportCard feeType="lbt" label="Local Business Tax" />
          <FeeRuleImportCard feeType="mayors_permit" label="Mayor's Permit Fee" />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Regulatory Fee Flat Amounts"
        sub="Flat, always-included fees on top of Local Business Tax and Mayor's Permit Fee — CNC, Health Permit Fee, Inspection Fee, Plate Fee, Sanitary Fee, whatever your LGU charges. Every fee here is added to every assessment automatically."
        status={{ label: `${activeRegulatoryFeeCount} active fee${activeRegulatoryFeeCount === 1 ? "" : "s"}`, tone: "neutral" }}
      >
        <Card className="flex flex-col gap-4 p-5">
          {regulatoryFees.length === 0 ? (
            <p className="text-[13px] text-ink-soft">No regulatory fees added yet.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {regulatoryFees.map((f) => (
                <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-[13px] font-bold ${f.is_active ? "text-ink" : "text-ink-faint line-through"}`}>{f.name}</span>
                    {f.delivery_mode === "reference_only" && <TonePill label="Paid at counter" tone="info" />}
                    {!f.is_active && <TonePill label="Inactive" tone="neutral" />}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-display text-[14px] font-bold tabular-nums text-ink">₱{Number(f.flat_amount ?? 0).toLocaleString()}</span>
                    <form action={setRegulatoryFeeAcctCode} className="flex items-center gap-1.5">
                      <input type="hidden" name="feeRuleId" value={f.id} />
                      <input
                        name="acctCode"
                        defaultValue={f.acct_code ?? ""}
                        placeholder="Acct Code"
                        aria-label={`Account code for ${f.name}`}
                        className="h-8 w-24 rounded-lg border border-border-strong bg-surface px-2 text-[12px] text-ink placeholder:text-ink-faint"
                      />
                      <MiniButton type="submit" tone="neutral">Save</MiniButton>
                    </form>
                    <form action={setRegulatoryFeeActive}>
                      <input type="hidden" name="feeRuleId" value={f.id} />
                      <input type="hidden" name="isActive" value={(!f.is_active).toString()} />
                      <MiniButton type="submit" tone={f.is_active ? "bad" : "neutral"}>{f.is_active ? "Deactivate" : "Reactivate"}</MiniButton>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}

          <form action={addRegulatoryFee} className="flex flex-wrap items-end gap-2.5 rounded-2xl bg-surface-2 p-4">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">Fee name</label>
              <input name="name" required placeholder="e.g. Sanitary Fee" className="h-9 w-52 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">Amount (₱)</label>
              <input name="amount" type="number" step="0.01" min="0" required className="h-9 w-32 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">Collected</label>
              <select name="deliveryMode" defaultValue="online" className="h-9 rounded-xl border border-border-strong bg-surface px-2.5 text-[13px] text-ink">
                <option value="online">Online, with the rest of the total</option>
                <option value="reference_only">At the physical counter</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">Acct Code (optional)</label>
              <input name="acctCode" placeholder="e.g. 582-2" className="h-9 w-28 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint" />
            </div>
            <PrimaryButton type="submit">Add a fee</PrimaryButton>
          </form>
        </Card>
      </CollapsibleSection>

      <CollapsibleSection
        title="Business Tax Installment Reminders"
        sub="A New application always pays the full annual Business Tax. A Renewal that chooses Bi-Annually or Quarterly pays the first installment now; MuniServe texts (and emails, if on file) a reminder for the rest, on the dates below. Applicants still pay the remaining balance the usual way — these dates aren't the same for every LGU, so nothing is reminded until you set them."
        status={installmentStatus}
      >
        <Card className="p-5">
          <form action={updateInstallmentReminderDates} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-bold text-ink-soft">Bi-Annual reminder date(s)</span>
              <input
                name="biannualDates"
                type="text"
                defaultValue={lgu.lbtBiannualReminderDates.join(", ")}
                placeholder="e.g. 07-05"
                className="h-9 w-full max-w-sm rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-bold text-ink-soft">Quarterly reminder date(s)</span>
              <input
                name="quarterlyDates"
                type="text"
                defaultValue={lgu.lbtQuarterlyReminderDates.join(", ")}
                placeholder="e.g. 04-05, 07-05, 10-05"
                className="h-9 w-full max-w-sm rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
              />
            </div>
            <p className="text-[11px] text-ink-faint">Format: MM-DD, comma-separated for more than one (e.g. &ldquo;04-05, 07-05, 10-05&rdquo;). No year -- the same dates apply every year.</p>
            <PrimaryButton type="submit" className="self-start">Save</PrimaryButton>
          </form>
        </Card>
      </CollapsibleSection>
      </SettingsGroup>

      <SettingsGroup icon={<PinIcon className="size-3.5" />} title="Barangays" description="The barangay list, and what MuniServe charges to generate a clearance.">
      <CollapsibleSection
        title="Barangays"
        sub="Shown as a dropdown on your public application form. Without any listed here, applicants type their barangay in as free text instead."
        status={barangays.length > 0 ? { label: `${barangays.length} barangays`, tone: "neutral" } : { label: "None added — form shows free text", tone: "warn" }}
      >
        <Card className="flex flex-col gap-4 p-5">
          {barangays.length === 0 ? (
            <p className="text-[13px] text-ink-soft">No barangays added yet — the application form currently shows a free-text field instead of a dropdown.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {barangays.map((b) => (
                <form key={b.id} action={removeBarangay} className="flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pl-3 pr-1.5">
                  <span className="text-[12.5px] font-bold text-ink">{b.value}</span>
                  <input type="hidden" name="id" value={b.id} />
                  <MiniButton type="submit" tone="bad" aria-label={`Remove ${b.value}`} title={`Remove ${b.value}`}>✕</MiniButton>
                </form>
              ))}
            </div>
          )}

          <form action={addBarangays} className="flex flex-wrap items-end gap-2.5 border-t border-border pt-4">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-[11.5px] font-bold text-ink-soft">Add barangay(s)</span>
              <input
                name="barangays"
                type="text"
                placeholder="e.g. Poblacion, Sta. Rita Matanda, Batasan Bata"
                className="h-9 w-full rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
              />
            </label>
            <PrimaryButton type="submit">Add</PrimaryButton>
          </form>
          <p className="text-[11px] text-ink-faint">One at a time, or paste a comma-separated list to add several at once.</p>
        </Card>
      </CollapsibleSection>

      <CollapsibleSection
        title="Barangay Clearance"
        sub="Charged when an applicant asks MuniServe to generate their clearance instead of bringing their own from the barangay. Set one rate for every barangay, or override specific ones below — an override always wins over the uniform rate for that barangay."
        status={barangayClearanceStatus}
      >
        <Card className="flex flex-col gap-4 p-5">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-faint">Uniform rate (applies to every barangay unless overridden below)</p>
            <form action={setBarangayClearanceRate} className="flex flex-wrap items-end gap-2.5">
              <input type="hidden" name="barangay" value="" />
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">Amount (₱)</label>
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={uniformBarangayClearance?.flat_amount ?? ""}
                  placeholder="Not set yet"
                  className="h-9 w-32 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">Acct Code (optional)</label>
                <input
                  name="acctCode"
                  defaultValue={uniformBarangayClearance?.acct_code ?? ""}
                  placeholder="e.g. 605-3"
                  className="h-9 w-28 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
                />
              </div>
              <MiniButton type="submit" tone="neutral">Save</MiniButton>
            </form>
          </div>

          {barangays.length === 0 ? (
            <p className="border-t border-border pt-4 text-[12px] text-ink-soft">
              Add your barangays above to set different rates per barangay.
            </p>
          ) : (
            <div className="border-t border-border pt-4">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-faint">Per-barangay overrides (optional)</p>
              <div className="flex flex-col divide-y divide-border">
                {barangays.map((b) => {
                  const override = barangayClearanceByAppliesTo.get(b.value);
                  return (
                    <form key={b.id} action={setBarangayClearanceRate} className="flex flex-wrap items-end gap-2.5 py-2">
                      <input type="hidden" name="barangay" value={b.value} />
                      <span className="min-w-32 text-[12.5px] font-bold text-ink">{b.value}</span>
                      <input
                        name="amount"
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={override?.flat_amount ?? ""}
                        placeholder="Uses uniform rate"
                        aria-label={`Barangay Clearance override rate for ${b.value}`}
                        className="h-8 w-32 rounded-lg border border-border-strong bg-surface px-2.5 text-[12px] text-ink placeholder:text-ink-faint"
                      />
                      <input
                        name="acctCode"
                        defaultValue={override?.acct_code ?? ""}
                        placeholder="Acct Code"
                        aria-label={`Account code for ${b.value}`}
                        className="h-8 w-24 rounded-lg border border-border-strong bg-surface px-2.5 text-[12px] text-ink placeholder:text-ink-faint"
                      />
                      <MiniButton type="submit" tone="neutral">Save</MiniButton>
                    </form>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </CollapsibleSection>
      </SettingsGroup>

      <SettingsGroup icon={<SettingsIcon className="size-4" />} title="Assessment Rules" description="How assessment behaves, not how much things cost.">
      <CollapsibleSection
        title="Automated Assessment"
        sub="A safe fallback if the automated Local Business Tax or Mayor's Permit Fee computation is ever wrong for your LGU."
        status={lgu.automatedAssessmentEnabled ? { label: "On", tone: "good" } : { label: "Off — manual entry", tone: "warn" }}
      >
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="text-[13px] font-bold text-ink">{lgu.automatedAssessmentEnabled ? "On -- computing automatically" : "Off -- manual entry required"}</p>
            <p className="mt-1 max-w-md text-[12px] text-ink-soft">
              {lgu.automatedAssessmentEnabled
                ? "Local Business Tax and Mayor's Permit Fee (and any graduated regulatory fee) compute automatically on every assessment."
                : "BPLO must type in the Local Business Tax and Mayor's Permit Fee amounts on every assessment. Regulatory fees above still apply automatically."}
            </p>
          </div>
          <form action={setAutomatedAssessmentEnabled}>
            <input type="hidden" name="enabled" value={(!lgu.automatedAssessmentEnabled).toString()} />
            <MiniButton type="submit" tone={lgu.automatedAssessmentEnabled ? "bad" : "good"}>
              {lgu.automatedAssessmentEnabled ? "Turn off" : "Turn back on"}
            </MiniButton>
          </form>
        </Card>
      </CollapsibleSection>

      <CollapsibleSection
        title="Building Permit Fee (Engineering)"
        sub="When on, Engineering enters their own computed amount during department review, and it's included in the applicant's total once approved."
        status={lgu.buildingPermitFeeEnabled ? { label: "On", tone: "good" } : { label: "Off", tone: "neutral" }}
      >
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-bold text-ink">{lgu.buildingPermitFeeEnabled ? "On -- Engineering can enter an amount" : "Off -- no field shown to Engineering"}</p>
              <p className="mt-1 max-w-md text-[12px] text-ink-soft">
                {lgu.buildingPermitFeeEnabled
                  ? "Engineering can't approve without entering an amount first."
                  : "Turn this on if Engineering computes and charges their own Building Permit Fee."}
              </p>
            </div>
            <form action={updateBuildingPermitFeeSettings}>
              <input type="hidden" name="enabled" value={(!lgu.buildingPermitFeeEnabled).toString()} />
              <input type="hidden" name="label" value={lgu.buildingPermitFeeLabel} />
              <MiniButton type="submit" tone={lgu.buildingPermitFeeEnabled ? "bad" : "good"}>
                {lgu.buildingPermitFeeEnabled ? "Turn off" : "Turn on"}
              </MiniButton>
            </form>
          </div>
          <form action={updateBuildingPermitFeeSettings} className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-bold text-ink-soft">Fee label</span>
              <input
                name="label"
                type="text"
                defaultValue={lgu.buildingPermitFeeLabel}
                placeholder="Building Permit Fee"
                className="h-9 w-64 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
              />
            </label>
            <input type="hidden" name="enabled" value={lgu.buildingPermitFeeEnabled.toString()} />
            <PrimaryButton type="submit">Save label</PrimaryButton>
          </form>
        </Card>
      </CollapsibleSection>

      <CollapsibleSection
        title="CEDULA (Community Tax Certificate)"
        sub="CEDULA's own amount is fixed by national law and never changes here — this only controls how it's collected."
        status={lgu.cedulaIncludedOnline ? { label: "Online", tone: "good" } : { label: "Counter-paid", tone: "info" }}
      >
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="text-[13px] font-bold text-ink">
              {lgu.cedulaIncludedOnline ? "Online -- included in the assessment total" : "Counter -- paid separately at Treasury"}
            </p>
            <p className="mt-1 max-w-md text-[12px] text-ink-soft">
              {lgu.cedulaIncludedOnline
                ? "CEDULA is included in the applicant's online total and issued as part of the application -- the form no longer asks them to upload a copy."
                : "Applicants pay for their CEDULA at the Treasurer's counter and upload a copy as part of their application (today's default)."}
            </p>
          </div>
          <form action={setCedulaIncludedOnline}>
            <input type="hidden" name="enabled" value={(!lgu.cedulaIncludedOnline).toString()} />
            <MiniButton type="submit" tone={lgu.cedulaIncludedOnline ? "bad" : "good"}>
              {lgu.cedulaIncludedOnline ? "Switch to counter payment" : "Include in online assessment"}
            </MiniButton>
          </form>
        </Card>
      </CollapsibleSection>
      </SettingsGroup>

      <SettingsGroup icon={<BellIcon className="size-4" />} title="Documents & Alerts" description="What gets printed, and what MuniServe texts out.">
      <CollapsibleSection
        title="Permit No. Format"
        sub="How your reference number looks, e.g. SMB-2026-000056 — three fields: a prefix you choose, the year, and an auto-incrementing number that resets every January. Applies to every new application going forward; permits already issued keep the number they were given."
        status={{ label: permitFormatPreview, tone: "neutral" }}
      >
        <PermitNumberFormatCard
          key={`${lgu.referencePrefix}|${lgu.referenceYearDigits}|${lgu.referenceCounterDigits}`}
          prefix={lgu.referencePrefix}
          yearDigits={lgu.referenceYearDigits}
          counterDigits={lgu.referenceCounterDigits}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="Permit Certificate Details"
        sub="Shown on the pre-signature certificate printed at the 'For Printing' stage — see the Applications tab."
        status={lgu.mayorName ? { label: "Mayor set", tone: "good" } : { label: "Mayor's name not set", tone: "warn" }}
      >
        <Card className="p-5">
          <form action={updateMayorName} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-bold text-ink-soft">Mayor&rsquo;s full name</span>
              <input
                name="mayorName"
                type="text"
                defaultValue={lgu.mayorName ?? ""}
                placeholder="e.g. John A. Alvarez"
                className="h-9 w-64 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
              />
            </label>
            <PrimaryButton type="submit">Save</PrimaryButton>
          </form>
        </Card>
        <div className="mt-3">
          <PrintTemplateUpload hasTemplate={Boolean(lgu.printTemplatePath)} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Order of Payment Details"
        sub="Shown on the itemized assessment slip applicants bring to the Treasurer's counter to pay — available once BPLO finalizes an assessment."
        status={lgu.treasurerName ? { label: "Treasurer set", tone: "good" } : { label: "Treasurer's name not set", tone: "warn" }}
      >
        <Card className="p-5">
          <form action={updateTreasurerName} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-bold text-ink-soft">Treasurer&rsquo;s full name</span>
              <input
                name="treasurerName"
                type="text"
                defaultValue={lgu.treasurerName ?? ""}
                placeholder="e.g. Pablo R. Sarmiento"
                className="h-9 w-64 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
              />
            </label>
            <PrimaryButton type="submit">Save</PrimaryButton>
          </form>
          <p className="mt-3 text-[11.5px] text-ink-soft">
            Acct Codes for each fee (shown on the same slip) are set per regulatory fee above — Local Business Tax and Mayor&rsquo;s Permit Fee codes aren&rsquo;t editable here yet.
          </p>
        </Card>
      </CollapsibleSection>

      <CollapsibleSection
        title="Accepted Payment Methods"
        sub="What applicants are told when their assessment is finalized — turn on as many as you actually accept. Cash at the counter is on by default, matching how every LGU starts out; GCash, Bank Transfer, and an Online Portal are each optional, with their own details shown once turned on."
        status={paymentMethodLabels.length > 0 ? { label: paymentMethodLabels.join(", "), tone: "good" } : { label: "None accepted", tone: "warn" }}
      >
        <PaymentMethodsCard
          key={[lgu.acceptsCashCounter, lgu.acceptsGcash, lgu.gcashNumber, lgu.gcashName, lgu.acceptsBankTransfer, lgu.bankName, lgu.bankAccountNumber, lgu.bankAccountName, lgu.acceptsOnlinePortal, lgu.onlinePortalUrl].join("|")}
          acceptsCashCounter={lgu.acceptsCashCounter}
          acceptsGcash={lgu.acceptsGcash}
          gcashNumber={lgu.gcashNumber}
          gcashName={lgu.gcashName}
          acceptsBankTransfer={lgu.acceptsBankTransfer}
          bankName={lgu.bankName}
          bankAccountNumber={lgu.bankAccountNumber}
          bankAccountName={lgu.bankAccountName}
          acceptsOnlinePortal={lgu.acceptsOnlinePortal}
          onlinePortalUrl={lgu.onlinePortalUrl}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="SMS Usage"
        sub="How many texts have gone out this month — OTP codes, status updates, and staff alerts all count. Resets to zero every month; unused SMS don't carry over."
        status={{ label: `${smsThisMonth.toLocaleString()} / ${SMS_FREE_MONTHLY_LIMIT.toLocaleString()} this month`, tone: smsThisMonth >= SMS_FREE_MONTHLY_LIMIT ? "warn" : "neutral" }}
      >
        <SmsUsageCard lguId={staff.lgu_id} />
      </CollapsibleSection>

      <CollapsibleSection
        title="SMS Notifications"
        sub="Every text MuniServe sends — OTP codes, status updates to applicants, alerts to staff."
        status={lgu.senderName ? { label: `"${lgu.senderName}"`, tone: "good" } : { label: "Default “BPLO:” prefix", tone: "neutral" }}
      >
        <Card className="p-5">
          <form action={updateSenderName} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-bold text-ink-soft">SMS Sender Name</span>
              <input
                name="senderName"
                type="text"
                defaultValue={lgu.senderName ?? ""}
                placeholder="e.g. SANMIGUELBPLO"
                className="h-9 w-64 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
              />
            </label>
            <PrimaryButton type="submit">Save</PrimaryButton>
          </form>
          <p className="mt-3 text-[11.5px] text-ink-soft">
            {lgu.senderName
              ? `Texts currently show "${lgu.senderName}" as the sender — no "BPLO:" prefix is added, since the name itself already identifies who's texting.`
              : "No custom Sender Name set yet — texts currently arrive under MuniServe's shared Semaphore sender, prefixed \"BPLO:\" so recipients know who it's from."}{" "}
            A custom Sender Name has to be purchased and approved directly with Semaphore (MuniServe&rsquo;s SMS provider) first — enter the exact approved name here once that&rsquo;s done.
          </p>
        </Card>
      </CollapsibleSection>
      </SettingsGroup>

      <SettingsGroup icon={<FileIcon className="size-3.5" />} title="Public Application Form" description="The link and embed code applicants actually use.">
      {lgu.subdomain ? (
        <CollapsibleSection title="Your public application form" sub="Share this link with applicants, or embed it on your own website so they never see the muniserve.ph URL.">
          <Card className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <a
                href={`https://${lgu.subdomain}.muniserve.ph/apply`}
                target="_blank"
                rel="noreferrer"
                className="text-[13.5px] font-bold text-info-ink underline underline-offset-2"
              >
                {lgu.subdomain}.muniserve.ph/apply
              </a>
              <span className="text-[12px] text-ink-soft">
                If this link isn&rsquo;t working yet, your domain is still being set up by MuniServe -- check back soon.
              </span>
            </div>
            <div className="border-t border-border pt-4">
              <p className="mb-2 text-[12px] font-bold text-ink-soft">
                Embed on your website (iframe) -- applicants see your own domain, not muniserve.ph:
              </p>
              <EmbedCodeBox code={buildApplyEmbedSnippet(lgu.subdomain)} />
            </div>
          </Card>
        </CollapsibleSection>
      ) : (
        <CollapsibleSection title="Your public application form">
          <p className="text-[13px] text-ink-soft">No subdomain is set for your LGU yet -- contact MuniServe support.</p>
        </CollapsibleSection>
      )}
      </SettingsGroup>
    </>
  );
}
