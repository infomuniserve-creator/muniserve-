import { SignOutButton } from "./sign-out-button";
import { Card } from "./ui";

/**
 * Shown instead of the entire dashboard shell (dashboard/layout.tsx never
 * renders {children} when this appears -- CLAUDE.md 7o follow-up) when a
 * real client staff member's own LGU has been paused by a platform admin
 * from /admin, e.g. for non-payment.
 *
 * Rebuilt on the shared design-token Card component (2026-08-20 audit
 * finding) rather than raw hardcoded colors -- previously ignored a staff
 * member's own dark-mode preference entirely (a jarring bright-white
 * screen even with dark mode on) and carried no MuniServe branding at all,
 * at exactly the stressful moment a client discovers their account is
 * paused. This still lives inside /dashboard, the one subtree with a
 * persisted theme preference, so it should look and feel like the rest of
 * that product, not a bare unbranded error page.
 */
export function PausedNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Card className="w-full max-w-[420px] p-10 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-warn-bg text-2xl">⏸️</div>
        <h1 className="mb-2 text-[18px] font-bold text-ink">Account paused</h1>
        <p className="mb-6 text-[13.5px] leading-relaxed text-ink-soft">
          Your account is currently paused. Please contact your administrator for more information.
        </p>
        <div className="mb-7 space-y-1 text-[13px] text-ink">
          <p className="m-0">
            📧 <a href="mailto:hello@muniserve.ph" className="text-brand-navy underline">hello@muniserve.ph</a>
          </p>
          <p className="m-0">📱 0977-440-1374</p>
        </div>
        <SignOutButton />
      </Card>
    </div>
  );
}
