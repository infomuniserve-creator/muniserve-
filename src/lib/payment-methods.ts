import type { LguDisplay } from "@/lib/lgu";

/**
 * Accepted Payment Methods (2026-08-19, CLAUDE.md) -- one shared place
 * that turns an LGU's own configured channels (Settings) into the actual
 * text shown to an applicant, used by the assessment-finalized SMS/email
 * (bplo/actions.ts) and the applicant status page (status/[reference]/
 * page.tsx) alike, so the two can never describe the payment options
 * differently. Multiple channels can be enabled at once (the project
 * owner's own confirmed choice) -- an LGU can accept cash AND GCash AND
 * bank transfer simultaneously.
 */
export type PaymentChannel = {
  label: string;
  /** One-line detail for a compact context (SMS, a status-page pill). */
  shortDetail: string;
  /** Fuller, possibly multi-sentence detail for email/a status-page card. */
  longDetail: string;
  /** True for GCash/Bank Transfer/Online -- these never go through MuniServe directly, so the applicant needs to prove they paid. */
  needsProofUpload: boolean;
};

export function getEnabledPaymentChannels(lgu: LguDisplay): PaymentChannel[] {
  const channels: PaymentChannel[] = [];

  if (lgu.acceptsCashCounter) {
    channels.push({
      label: "Cash",
      shortDetail: "Cash at the Treasurer's Office",
      longDetail: "Pay in cash in person at the Treasurer's Office.",
      needsProofUpload: false,
    });
  }
  if (lgu.acceptsGcash && lgu.gcashNumber) {
    channels.push({
      label: "GCash",
      shortDetail: `GCash ${lgu.gcashNumber}`,
      longDetail: `GCash: send to ${lgu.gcashNumber}${lgu.gcashName ? ` (${lgu.gcashName})` : ""}, then upload your payment screenshot/receipt.`,
      needsProofUpload: true,
    });
  }
  if (lgu.acceptsBankTransfer && lgu.bankName && lgu.bankAccountNumber) {
    channels.push({
      label: "Bank Transfer",
      shortDetail: `${lgu.bankName} ${lgu.bankAccountNumber}`,
      longDetail: `Bank Transfer: ${lgu.bankName}, Account No. ${lgu.bankAccountNumber}${lgu.bankAccountName ? ` (${lgu.bankAccountName})` : ""}, then upload your deposit/transfer receipt.`,
      needsProofUpload: true,
    });
  }
  if (lgu.acceptsOnlinePortal && lgu.onlinePortalUrl) {
    channels.push({
      label: "Online",
      shortDetail: `Online: ${lgu.onlinePortalUrl}`,
      longDetail: `Online: pay at ${lgu.onlinePortalUrl}, then upload your payment confirmation.`,
      needsProofUpload: true,
    });
  }

  return channels;
}

export function anyChannelNeedsProofUpload(channels: PaymentChannel[]): boolean {
  return channels.some((c) => c.needsProofUpload);
}

/** Compact, single-line -- for the assessment-finalized SMS. Falls back to the old generic line if nothing is configured at all (shouldn't happen given accepts_cash_counter defaults true, but a real LGU could turn everything off). */
export function formatPaymentChannelsForSms(channels: PaymentChannel[]): string {
  if (channels.length === 0) return "Contact the BPLO office to arrange payment.";
  return `Pay via: ${channels.map((c) => c.shortDetail).join(", or ")}.`;
}

/** Fuller HTML list -- for the assessment-finalized email. */
export function formatPaymentChannelsForEmailHtml(channels: PaymentChannel[]): string {
  if (channels.length === 0) return "<p>Contact the BPLO office to arrange payment.</p>";
  return `<p><strong>How to pay:</strong></p><ul>${channels.map((c) => `<li>${c.longDetail}</li>`).join("")}</ul>`;
}
