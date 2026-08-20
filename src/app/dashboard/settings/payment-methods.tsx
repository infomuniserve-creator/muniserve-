"use client";

import { useState } from "react";
import { Card, PrimaryButton } from "../ui";
import { updatePaymentMethods } from "./actions";

type Props = {
  acceptsCashCounter: boolean;
  acceptsGcash: boolean;
  gcashNumber: string | null;
  gcashName: string | null;
  acceptsBankTransfer: boolean;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  acceptsOnlinePortal: boolean;
  onlinePortalUrl: string | null;
};

/**
 * Accepted Payment Methods (2026-08-19) -- multiple channels can be on
 * at once (the project owner's own confirmed choice). Only made a client
 * component for the "turning a toggle on reveals its own detail fields"
 * behavior the project owner specifically asked for -- the actual submit
 * still goes through one plain server-action form, same shape as every
 * other Settings card. See actions.ts's updatePaymentMethods for the
 * real validation (this component's own checks are just for disabling
 * Save early, not authoritative).
 *
 * IMPORTANT for the caller (settings/page.tsx): pass a `key` derived from
 * every prop below. React 19 resets a <form>'s own DOM elements after a
 * successful `action={fn}` submit -- confirmed directly (a temporary
 * repro fixture, 2026-08-19, right after a real user report: the
 * checkboxes visually unchecked themselves immediately after a
 * successful Save, even though the database write was correct) that
 * this reverts a controlled checkbox's visible checked state to
 * whatever it was at mount, even though this component's own state
 * still (correctly) reflects the just-saved value -- a plain <input>
 * text field is NOT affected, only checkbox/<select> elements are.
 * Without a key that changes on a real save, every toggle here would
 * visually snap back to unchecked right after clicking Save. A `key`
 * forces a clean remount on the next server-refreshed props, sidestepping
 * the desync entirely instead of fighting it.
 */
export function PaymentMethodsCard(props: Props) {
  const [cash, setCash] = useState(props.acceptsCashCounter);
  const [gcash, setGcash] = useState(props.acceptsGcash);
  const [gcashNumber, setGcashNumber] = useState(props.gcashNumber ?? "");
  const [bank, setBank] = useState(props.acceptsBankTransfer);
  const [bankName, setBankName] = useState(props.bankName ?? "");
  const [bankAccountNumber, setBankAccountNumber] = useState(props.bankAccountNumber ?? "");
  const [online, setOnline] = useState(props.acceptsOnlinePortal);
  const [onlinePortalUrl, setOnlinePortalUrl] = useState(props.onlinePortalUrl ?? "");

  const gcashValid = !gcash || gcashNumber.trim() !== "";
  const bankValid = !bank || (bankName.trim() !== "" && bankAccountNumber.trim() !== "");
  const onlineValid = !online || /^https?:\/\//i.test(onlinePortalUrl.trim());

  return (
    <Card className="p-5">
      <form action={updatePaymentMethods} className="flex flex-col gap-5">
        <label className="flex items-center gap-2.5">
          <input type="checkbox" name="acceptsCashCounter" checked={cash} onChange={(e) => setCash(e.target.checked)} className="size-4 rounded border-border-strong" />
          <span className="text-[13px] font-bold text-ink">Cash (Over the Counter)</span>
        </label>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <label className="flex items-center gap-2.5">
            <input type="checkbox" name="acceptsGcash" checked={gcash} onChange={(e) => setGcash(e.target.checked)} className="size-4 rounded border-border-strong" />
            <span className="text-[13px] font-bold text-ink">GCash</span>
          </label>
          {gcash && (
            <div className="ml-6 flex flex-wrap gap-2.5">
              <input
                name="gcashNumber"
                type="text"
                value={gcashNumber}
                onChange={(e) => setGcashNumber(e.target.value)}
                placeholder="GCash number, e.g. 09171234567"
                aria-label="GCash number"
                className="h-9 w-56 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
              />
              <input
                name="gcashName"
                type="text"
                defaultValue={props.gcashName ?? ""}
                placeholder="Name on the account (optional)"
                aria-label="GCash account name"
                className="h-9 w-56 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <label className="flex items-center gap-2.5">
            <input type="checkbox" name="acceptsBankTransfer" checked={bank} onChange={(e) => setBank(e.target.checked)} className="size-4 rounded border-border-strong" />
            <span className="text-[13px] font-bold text-ink">Bank Transfer</span>
          </label>
          {bank && (
            <div className="ml-6 flex flex-wrap gap-2.5">
              <input
                name="bankName"
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="Bank name, e.g. Landbank"
                aria-label="Bank name"
                className="h-9 w-48 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
              />
              <input
                name="bankAccountNumber"
                type="text"
                value={bankAccountNumber}
                onChange={(e) => setBankAccountNumber(e.target.value)}
                placeholder="Account number"
                aria-label="Bank account number"
                className="h-9 w-48 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
              />
              <input
                name="bankAccountName"
                type="text"
                defaultValue={props.bankAccountName ?? ""}
                placeholder="Account name (optional)"
                aria-label="Bank account name"
                className="h-9 w-48 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <label className="flex items-center gap-2.5">
            <input type="checkbox" name="acceptsOnlinePortal" checked={online} onChange={(e) => setOnline(e.target.checked)} className="size-4 rounded border-border-strong" />
            <span className="text-[13px] font-bold text-ink">Online Portal</span>
          </label>
          {online && (
            <div className="ml-6">
              <input
                name="onlinePortalUrl"
                type="text"
                value={onlinePortalUrl}
                onChange={(e) => setOnlinePortalUrl(e.target.value)}
                placeholder="e.g. your Landbank LinkBiz URL"
                aria-label="Online payment portal URL"
                className="h-9 w-96 max-w-full rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
              />
            </div>
          )}
        </div>

        <PrimaryButton type="submit" disabled={!gcashValid || !bankValid || !onlineValid} className="self-start">
          Save
        </PrimaryButton>
      </form>
    </Card>
  );
}
