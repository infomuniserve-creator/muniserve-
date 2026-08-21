import { KbCard, KbChannel, KbSection, KbTip } from "./kb-ui";

export function ReportingSection() {
  return (
    <KbSection id="reporting" icon="📊" title="Audit Trail & Stats" sub="BPLO and the Mayor only.">
      <KbCard title="Audit Trail">
        <p>
          A complete, chronological log of everything that happened on this LGU&rsquo;s account — every decision, payment,
          signature, and staff change, with who did it and when. Browse it by application (one row per application,
          expand to see its full timeline) or view every other kind of activity (staff/account changes) separately.
          Export either view to CSV.
        </p>
      </KbCard>

      <KbCard title="Stats & Reports">
        <p>Two tabs answering two different questions:</p>
        <ul>
          <li><b>Performance</b> — how fast applications actually move, and where the real bottleneck is (compared honestly across every stage, not just which department happens to be slowest among the others).</li>
          <li><b>Reports</b> — how much revenue was actually collected, broken down into Barangay Clearance, Engineering, CEDULA, and Actual Permit (Local Business Tax + Mayor&rsquo;s Permit Fee + other regulatory fees), each downloadable.</li>
        </ul>
      </KbCard>
    </KbSection>
  );
}

type NotifRow = { when: string; sms: boolean; email: boolean; what: string };

const NOTIF_ROWS: NotifRow[] = [
  { when: "Logging in, renewing, or re-verifying on a new device", sms: true, email: false, what: "A plain 6-digit code to type in. No other content." },
  { when: "BPLO requests more info at Initial Review", sms: true, email: true, what: "Quotes BPLO's own note, and a button to upload what's needed straight from their status page." },
  { when: "BPLO rejects at Initial Review", sms: true, email: true, what: "Says the application was not approved and is now closed. Quotes the reason, if one was given." },
  { when: "BPLO approves Initial Review, and BFP is one of your departments", sms: true, email: true, what: "Explains BFP works independently and the Fire Safety Inspection Fee is paid directly to them — with a button to upload proof of payment once they've paid." },
  { when: "A department requests more info, or rejects", sms: true, email: true, what: "Names the department, quotes their note, and a button to upload what's needed." },
  { when: "BPLO finalizes the assessment", sms: true, email: true, what: "SMS gives the total due and points to the email for details. The email has the itemized breakdown, the Order of Payment PDF attached, how to pay, and (if a channel needs it) a button to upload proof of payment." },
  { when: "Treasury requests more info (doesn't block paying)", sms: true, email: true, what: "Quotes Treasury's own note, with a button to upload what's needed." },
  { when: "Treasury (or BPLO on their behalf) records payment", sms: true, email: true, what: "Confirms the payment was received and the permit is now being printed." },
  { when: "The Mayor (or BPLO on their behalf) signs the permit", sms: true, email: true, what: "Says the permit is signed and ready for pickup at the BPLO office." },
  { when: "BPLO releases the permit", sms: true, email: true, what: "Confirms release, with a button to view/download the permit." },
  { when: "A Bi-Annual or Quarterly renewal's next installment is due", sms: true, email: true, what: "Reminds them of the amount and that it's due at the Treasurer's Office." },
];

export function NotificationsSection() {
  return (
    <KbSection
      id="notifications"
      icon="📩"
      title="What Applicants Are Told"
      sub="Every automatic SMS and email your applicants receive, in the order they'd actually get them — so you can answer 'did they get notified?' with confidence."
    >
      <KbCard>
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th className="border-b border-border-strong px-2.5 pb-2 text-left text-[10.5px] font-extrabold uppercase tracking-wide text-ink-faint">When</th>
                <th className="border-b border-border-strong px-2.5 pb-2 text-left text-[10.5px] font-extrabold uppercase tracking-wide text-ink-faint">Channels</th>
                <th className="border-b border-border-strong px-2.5 pb-2 text-left text-[10.5px] font-extrabold uppercase tracking-wide text-ink-faint">What it says</th>
              </tr>
            </thead>
            <tbody>
              {NOTIF_ROWS.map((r, i) => (
                <tr key={i}>
                  <td className="border-b border-border px-2.5 py-3 align-top font-bold text-ink">{r.when}</td>
                  <td className="border-b border-border px-2.5 py-3 align-top">
                    <div className="flex gap-1.5">
                      {r.sms && <KbChannel kind="sms" />}
                      {r.email && <KbChannel kind="email" />}
                    </div>
                  </td>
                  <td className="border-b border-border px-2.5 py-3 align-top italic text-ink-soft">{r.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </KbCard>
      <KbTip>Email is only sent when the owner has an email on file — phone is guaranteed (it&rsquo;s how applicants sign in at all), so SMS always goes out regardless.</KbTip>
      <KbTip tone="warn">Every branded email carries your LGU&rsquo;s own name and logo (once uploaded in Settings), so applicants can trust it&rsquo;s genuinely from your office, not a scam.</KbTip>
    </KbSection>
  );
}

export function FaqSection() {
  return (
    <KbSection id="faq" icon="❓" title="FAQ & Troubleshooting" sub="Quick answers to the questions that come up most.">
      <KbCard title="A department reviewer says they can't see another department's applications — is that a bug?">
        <p>No — that&rsquo;s by design. A department can only ever see and act on its own queue, enforced at the database level, not just hidden in the menu. Only BPLO can see across every department.</p>
      </KbCard>
      <KbCard title="I can't click Approve on Initial Review — why?">
        <p>The business almost certainly has no LBT category set yet. Set it right on the card (or from Businesses if it&rsquo;s not showing there) and Approve unlocks immediately.</p>
      </KbCard>
      <KbCard title="Why won't the form let me submit Request more info / Reject with a blank note?">
        <p>Notes are required for anything except a plain Approve, on every reviewing surface (BPLO, departments, Treasury) — this is enforced, not just suggested, so an applicant is never left with no idea what to fix.</p>
      </KbCard>
      <KbCard title="An applicant says they never got a text or email — what do I check?">
        <p>Confirm a phone number (and email, if expected) is actually on file for that owner in Businesses. Email specifically is only sent when one exists — phone is the one channel guaranteed for every applicant.</p>
      </KbCard>
      <KbCard title="Can I act for a role I don't personally have?">
        <p>BPLO can act on a department&rsquo;s behalf, on Treasury&rsquo;s behalf (record a payment), and on the Mayor&rsquo;s behalf (sign a permit) — useful when someone&rsquo;s out, or an applicant walks the paperwork straight to BPLO instead. Every action taken this way is still logged with who really did it.</p>
      </KbCard>
    </KbSection>
  );
}
