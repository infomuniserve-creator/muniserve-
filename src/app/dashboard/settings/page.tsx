import { getCurrentStaff, officeIdentity } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { buildApplyEmbedSnippet } from "@/lib/embed";
import { createClient } from "@/lib/supabase/server";
import { EmbedCodeBox } from "@/components/embed-code-box";
import { redirect } from "next/navigation";
import { SignOutButton } from "../sign-out-button";
import { Card, DashboardTopBar, MiniButton, PrimaryButton, SectionHead, TonePill } from "../ui";
import { addRegulatoryFee, setAutomatedAssessmentEnabled, setRegulatoryFeeActive, updateMayorName } from "./actions";
import { FeeRuleImportCard } from "./fee-rule-import";
import { StaffManagementSection } from "./staff-management";

/**
 * BPLO-only settings hub (CLAUDE.md section 7o follow-up). Originally
 * split out of /dashboard/staff to separate LGU-level configuration from
 * staff-account management; as of 2026-08-15, staff management moved back
 * in as this page's own first section ("Add/Remove Staff") instead of a
 * separate top-nav tab -- it's an occasional admin task, same category as
 * everything else here, not a primary day-to-day section like
 * Applications or Businesses. This page is meant to keep growing: more
 * LGU-level settings land here going forward.
 */
export default async function SettingsPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "bplo") redirect("/dashboard");

  const office = officeIdentity(staff);
  const supabase = await createClient();
  const lgu = await getLguDisplay(supabase, staff.lgu_id);

  const { data: regulatoryFeesRaw } = await supabase
    .from("fee_rules")
    .select("id, name, flat_amount, delivery_mode, is_active")
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

  return (
    <>
      <DashboardTopBar
        officeLabel={office.label}
        officeSub={`${lgu.name}, ${lgu.province}`}
        initials={office.initials}
        active="settings"
        applicationsHref={office.homeHref}
        settingsHref="/dashboard/settings"
        auditHref="/dashboard/audit"
        statsHref="/dashboard/stats"
        rightSlot={<SignOutButton />}
      />

      <StaffManagementSection lguName={lgu.name} lguProvince={lgu.province} staffList={staffListRaw ?? []} departments={departmentsRaw ?? []} />

      <div className="mb-9">
        <SectionHead
          title="Business Tax & Mayor's Permit Fee Setup"
          sub="Set or update your LGU's Local Business Tax and Mayor's Permit Fee rates yourself -- download the current rates, edit them in Excel/Sheets, upload the file back. No developer needed."
        />
        <div className="flex flex-col gap-3">
          <FeeRuleImportCard feeType="lbt" label="Local Business Tax" />
          <FeeRuleImportCard feeType="mayors_permit" label="Mayor's Permit Fee" />
        </div>
      </div>

      <div className="mb-9">
        <SectionHead
          title="Regulatory Fee Flat Amounts"
          sub="Flat, always-included fees on top of Local Business Tax and Mayor's Permit Fee -- CNC, Health Permit Fee, Inspection Fee, Plate Fee, Sanitary Fee, whatever your LGU charges. Every fee here is added to every assessment automatically."
        />
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
            <PrimaryButton type="submit">Add a fee</PrimaryButton>
          </form>
        </Card>
      </div>

      <div className="mb-9">
        <SectionHead
          title="Automated Assessment"
          sub="A safe fallback if the automated Local Business Tax or Mayor's Permit Fee computation is ever wrong for your LGU."
        />
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
      </div>

      <div className="mb-9">
        <SectionHead
          title="Permit Certificate Details"
          sub="Shown on the pre-signature certificate printed at the 'For Printing' stage — see the Applications tab."
        />
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
      </div>

      {lgu.subdomain ? (
        <div className="mb-9">
          <SectionHead title="Your public application form" sub="Share this link with applicants, or embed it on your own website so they never see the muniserve.ph URL." />
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
        </div>
      ) : (
        <div className="mb-9">
          <SectionHead title="Your public application form" />
          <p className="text-[13px] text-ink-soft">No subdomain is set for your LGU yet -- contact MuniServe support.</p>
        </div>
      )}
    </>
  );
}
