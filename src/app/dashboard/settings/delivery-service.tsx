"use client";

import { useState } from "react";
import { Card, PrimaryButton } from "../ui";
import { updateDeliveryService } from "./actions";

type Props = {
  deliveryServiceEnabled: boolean;
  courierName: string | null;
  courierPhone: string | null;
};

/**
 * Delivery Service (2026-08-22) -- same "toggle reveals its own detail
 * fields" client-interactivity shape as PaymentMethodsCard, for the exact
 * same reason: nothing else on this page needed client state until that
 * component asked for this specific behavior.
 *
 * IMPORTANT for the caller (settings/page.tsx): pass a `key` derived from
 * every prop below -- PaymentMethodsCard's own doc comment explains why
 * (React 19 resets a <form>'s own DOM elements after a successful
 * action={fn} submit, which silently reverts a controlled checkbox's
 * visible state back to how it was at mount unless a changed `key` forces
 * a clean remount). Same bug class, same fix, not re-derived here.
 */
export function DeliveryServiceCard(props: Props) {
  const [enabled, setEnabled] = useState(props.deliveryServiceEnabled);
  const [courierName, setCourierName] = useState(props.courierName ?? "");
  const [courierPhone, setCourierPhone] = useState(props.courierPhone ?? "");

  const valid = !enabled || (courierName.trim() !== "" && courierPhone.trim() !== "");

  return (
    <Card className="p-5">
      <form action={updateDeliveryService} className="flex flex-col gap-3">
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            name="deliveryServiceEnabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="size-4 rounded border-border-strong"
          />
          <span className="text-[13px] font-bold text-ink">Offer delivery instead of pickup</span>
        </label>
        {enabled && (
          <div className="ml-6 flex flex-wrap gap-2.5">
            <input
              name="courierName"
              type="text"
              value={courierName}
              onChange={(e) => setCourierName(e.target.value)}
              placeholder="Courier company name"
              aria-label="Courier company name"
              className="h-9 w-56 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
            />
            <input
              name="courierPhone"
              type="tel"
              value={courierPhone}
              onChange={(e) => setCourierPhone(e.target.value)}
              placeholder="Courier mobile no., e.g. 09171234567"
              aria-label="Courier mobile number"
              className="h-9 w-64 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
            />
          </div>
        )}
        <p className="text-[11px] text-ink-faint">
          When on, applicants whose permit is ready for release can request delivery from their status page. Your courier gets a text with the owner&rsquo;s name, phone, and address to pick it up from — you still hand it to them at your counter, same as any other release.
        </p>
        <PrimaryButton type="submit" disabled={!valid} className="self-start">
          Save
        </PrimaryButton>
      </form>
    </Card>
  );
}
