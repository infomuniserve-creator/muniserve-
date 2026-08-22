import type { LguDisplay } from "@/lib/lgu";

/**
 * The one shared shell behind every applicant-facing email (2026-08-21) --
 * previously each call site (bplo/actions.ts, info-requests.ts,
 * treasury/actions.ts, mayor/actions.ts, the installment-reminder cron)
 * built its own bare <p> tags directly, with no LGU identity, no
 * consistent greeting, and no visual structure. The project owner's own
 * reasoning for this pass: most of MuniServe's real applicants aren't
 * confident English readers, so a plain wall of text reads as harder AND
 * less trustworthy than a real letterhead with one obvious next action.
 *
 * Table-based layout + inline styles throughout, deliberately -- this
 * renders inside a recipient's real mail client (Gmail, Outlook, a phone's
 * default mail app), not this app's own dark-mode-aware Tailwind system.
 * Most email clients strip <style> blocks and don't support flexbox/grid
 * at all, so every color/spacing decision has to travel as an inline
 * style or it silently disappears. A reasonable first draft matching this
 * app's own navy/teal brand identity (globals.css), not a pixel-locked
 * Outlook/Litmus-tested build -- same "reasonable first draft" framing
 * already used for this project's generated PDFs.
 */

const FONT_STACK = "Arial, Helvetica, sans-serif";

/** owners.full_name is a single joined column (CLAUDE.md 7h) -- there's no separate stored first name to read instead, so this is a plain client-side-safe derivation, not a data model gap. */
export function firstNameOf(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first || "there";
}

export type ApplicantEmailOptions = {
  lgu: LguDisplay;
  /** e.g. lgu.bploOfficeName, "Office of the Municipal Treasurer", or a department's own name ("MHO") -- whichever office this specific notification is actually from. */
  officeLabel: string;
  greetingName: string;
  /** Pre-built inner HTML -- plain <p> tags plus this file's own noteBoxHtml()/amountDetailBoxHtml() as needed. Inherits this shell's own font/color/size, so callers don't need to repeat inline styles on every paragraph. */
  bodyHtml: string;
  cta?: { label: string; href: string };
};

/** Renders the full branded email shell. Every applicant-facing notifyApplicantEmail() call should build its HTML through this, not bare <p> tags. */
export function renderApplicantEmailHtml(opts: ApplicantEmailOptions): string {
  const { lgu, officeLabel, greetingName, bodyHtml, cta } = opts;
  const location = [lgu.name, lgu.province].filter(Boolean).join(", ");

  const logoCell = lgu.logoUrl
    ? `<td style="width:52px;padding-right:14px;vertical-align:middle;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:52px;height:52px;border-radius:50%;background:#ffffff;text-align:center;vertical-align:middle;"><img src="${lgu.logoUrl}" width="40" height="40" alt="${lgu.name} logo" style="display:block;margin:6px auto 0;border-radius:50%;object-fit:cover;" /></td></tr></table></td>`
    : "";

  const ctaBlock = cta
    ? `<tr><td align="center" style="padding:6px 30px 4px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:#16a189;"><a href="${cta.href}" style="display:inline-block;padding:13px 30px;font-family:${FONT_STACK};font-weight:bold;font-size:14.5px;color:#ffffff;text-decoration:none;">${cta.label}</a></td></tr></table></td></tr>`
    : "";

  return `<div style="margin:0;padding:0;background:#eef1f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;border:1px solid #e2e7ed;">
<tr><td style="background-color:#0f2d52;background-image:linear-gradient(120deg,#0f2d52 0%,#123a67 55%,#16a189 130%);padding:26px 28px;border-radius:14px 14px 0 0;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
${logoCell}
<td style="font-family:${FONT_STACK};color:#ffffff;">
<div style="font-weight:bold;font-size:15.5px;line-height:1.3;">${lgu.displayName}</div>
<div style="font-size:12px;opacity:0.85;margin-top:2px;">${officeLabel}</div>
</td>
</tr></table>
</td></tr>
<tr><td style="padding:30px 30px 6px;font-family:${FONT_STACK};color:#3c4650;font-size:14.5px;line-height:1.65;">
<div style="font-weight:bold;font-size:19px;color:#14202e;margin:0 0 14px;">Hi ${greetingName},</div>
${bodyHtml}
</td></tr>
${ctaBlock}
<tr><td style="padding:22px 30px 26px;border-top:1px solid #eef1f5;font-family:${FONT_STACK};">
<div style="font-size:12px;color:#5b6675;font-weight:bold;">${officeLabel}${location ? ` — ${location}` : ""}</div>
<div style="font-size:12px;color:#8a93a1;margin-top:6px;">This is an automated message from ${lgu.name}.</div>
</td></tr>
</table>
</td></tr>
</table>
</div>`;
}

/** A department's/Treasury's/BPLO's own request note, quoted back to the applicant exactly as written rather than summarized -- so "upload a clearer copy of your DTI" stays that specific instruction, not a vaguer paraphrase. */
export function noteBoxHtml(note: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 16px;"><tr><td style="background:#fdf1dd;border:1px solid #f2ddb2;border-radius:10px;padding:12px 14px;font-family:${FONT_STACK};font-size:13.5px;color:#8a5a12;line-height:1.55;">&ldquo;${note}&rdquo;</td></tr></table>`;
}

/** An itemized amount-due box -- one row per included fee line plus a bold total row, so the one number that matters (the total) is never buried in a paragraph. */
export function amountDetailBoxHtml(lines: { label: string; amount: number }[], total: number): string {
  const rows = lines
    .map(
      (l) =>
        `<tr><td style="padding:10px 16px;font-family:${FONT_STACK};font-size:13.5px;color:#5b6675;border-bottom:1px solid #eef1f5;">${l.label}</td><td align="right" style="padding:10px 16px;font-family:${FONT_STACK};font-size:13.5px;font-weight:bold;color:#14202e;border-bottom:1px solid #eef1f5;">₱${l.amount.toLocaleString()}</td></tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 16px;border:1px solid #e2e7ed;border-radius:12px;">
${rows}
<tr><td style="padding:11px 16px;font-family:${FONT_STACK};font-size:13.5px;font-weight:bold;color:#14202e;background:#f6f8fa;border-radius:0 0 0 12px;">Total to pay</td><td align="right" style="padding:11px 16px;font-family:${FONT_STACK};font-size:15px;font-weight:bold;color:#0f2d52;background:#f6f8fa;border-radius:0 0 12px 0;">₱${total.toLocaleString()}</td></tr>
</table>`;
}
