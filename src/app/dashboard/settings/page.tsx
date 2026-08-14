import { getCurrentStaff, officeIdentity } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { buildApplyEmbedSnippet } from "@/lib/embed";
import { createClient } from "@/lib/supabase/server";
import { EmbedCodeBox } from "@/components/embed-code-box";
import { redirect } from "next/navigation";
import { SignOutButton } from "../sign-out-button";
import { Card, DashboardTopBar, SectionHead } from "../ui";

/**
 * BPLO-only settings hub (CLAUDE.md section 7o follow-up) -- split out of
 * /dashboard/staff, which was starting to carry two unrelated concerns
 * (managing staff accounts vs. LGU-level configuration like the public
 * application form's link/embed code). This page is meant to grow: more
 * LGU-level settings land here going forward rather than back on the
 * Staff page.
 *
 * Same guard as /dashboard/staff (BPLO only) -- settings here are about
 * the whole LGU's configuration, not any one staff member's own account.
 */
export default async function SettingsPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "bplo") redirect("/dashboard");

  const office = officeIdentity(staff);
  const supabase = await createClient();
  const lgu = await getLguDisplay(supabase, staff.lgu_id);

  return (
    <>
      <DashboardTopBar
        officeLabel={office.label}
        officeSub={`${lgu.name}, ${lgu.province}`}
        initials={office.initials}
        active="settings"
        applicationsHref={office.homeHref}
        staffHref="/dashboard/staff"
        settingsHref="/dashboard/settings"
        auditHref="/dashboard/audit"
        statsHref="/dashboard/stats"
        rightSlot={<SignOutButton />}
      />

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
