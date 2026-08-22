import { getCurrentStaff } from "@/lib/staff";
import { getCurrentPlatformAdmin } from "@/lib/platform-admin";
import { redirect } from "next/navigation";
import { SignOutButton } from "./sign-out-button";
import { Card } from "./ui";

/**
 * Landing spot after login. Checks getCurrentStaff() first, not platform
 * admin -- a platform admin who has picked a "view as" target from /admin
 * (CLAUDE.md 7o follow-up) now HAS a staff_users row (a reusable proxy,
 * migration 0019) and should land in that role's real dashboard exactly
 * like genuine staff would, not get bounced back to /admin. Only falls
 * through to the platform-admin check -- and from there to /admin -- when
 * no staff row exists at all, i.e. they haven't picked a client to view
 * yet (or are signed in with no role of any kind).
 */
export default async function DashboardRouterPage() {
  const staff = await getCurrentStaff();

  if (staff) {
    if (staff.role === "bplo") redirect("/dashboard/bplo");
    if (staff.role === "mayor") redirect("/dashboard/mayor");
    if (staff.role === "department") redirect("/dashboard/department");
    if (staff.role === "treasury") redirect("/dashboard/treasury");
  }

  const platformAdmin = await getCurrentPlatformAdmin();
  if (platformAdmin) redirect("/admin");

  // Rebuilt on the shared design-token Card (2026-08-20 audit finding),
  // matching PausedNotice's identical fix -- previously raw hardcoded
  // colors with no dark-mode or brand support at all.
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Card className="w-full max-w-[420px] p-10 text-center">
        <h1 className="mb-2 text-[18px] font-bold text-ink">Not provisioned</h1>
        <p className="mb-6 text-[13px] leading-relaxed text-ink-soft">
          You&rsquo;re signed in with Google, but this account isn&rsquo;t set up as staff yet
          (or has been deactivated). Ask BPLO to add you as staff.
        </p>
        <SignOutButton />
      </Card>
    </div>
  );
}
