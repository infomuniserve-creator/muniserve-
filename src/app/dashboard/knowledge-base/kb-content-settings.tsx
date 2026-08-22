import { KbCard, KbSection, KbTip } from "./kb-ui";

export function SettingsSection() {
  return (
    <KbSection id="settings" icon="⚙️" title="Settings" sub="BPLO only. Grouped into 7 categories — every section starts collapsed, so click a title to open it.">
      <KbCard title="Staff & Access">
        <p>Add a new staff account (email, role, and department if applicable), and deactivate one that&rsquo;s no longer active. A brand-new hire claims their own account automatically the first time they sign in with Google using that exact email.</p>
        <KbTip tone="warn">You can&rsquo;t deactivate the last active BPLO account at your LGU — there has to always be at least one person who can manage staff.</KbTip>
      </KbCard>

      <KbCard title="Data Import">
        <p>Bring in your existing business roster from a spreadsheet (an Excel/CSV export from whatever you used before). A row with a phone number is claimed immediately, so that owner can renew online right away; a row with no phone number still imports, just unclaimed until someone attaches a number later.</p>
      </KbCard>

      <KbCard title="Fee Rates">
        <p>How much things actually cost:</p>
        <ul>
          <li><b>Business Tax &amp; Mayor&rsquo;s Permit Fee Setup</b> — download a template, fill in your LGU&rsquo;s real rates from the actual ordinance, upload it back. This is also where LBT categories come from — each row in the file is one selectable category.</li>
          <li><b>Regulatory Fee Flat Amounts</b> — CNC, Health Permit Fee, Inspection Fee, and similar flat fees.</li>
          <li><b>Business Tax Installment Reminders</b> — the dates a Bi-Annual or Quarterly renewal gets reminded about the rest of what&rsquo;s owed.</li>
        </ul>
      </KbCard>

      <KbCard title="Barangays">
        <p>The barangay list shown as a dropdown on the public application form, and (if your LGU charges for one) the Barangay Clearance rate — a uniform rate, or a different one per barangay.</p>
      </KbCard>

      <KbCard title="Assessment Rules">
        <ul>
          <li><b>Automated Assessment</b> — a safety switch. If it&rsquo;s ever off, BPLO enters Local Business Tax and Mayor&rsquo;s Permit Fee by hand instead of trusting the computed number.</li>
          <li><b>Building Permit Fee (Engineering)</b> — turn on if Engineering needs to type in their own assessed figure (this fee genuinely varies per building, so nothing computes it automatically).</li>
          <li><b>CEDULA</b> — whether it&rsquo;s included in the online total, or paid separately at the counter like it always used to be.</li>
        </ul>
      </KbCard>

      <KbCard title="Documents & Alerts">
        <p>Everything that shapes what gets printed and what gets sent out:</p>
        <ul>
          <li><b>LGU Logo</b> — shown in the header of every applicant email and on the Order of Payment slip.</li>
          <li><b>Permit No. Format</b> — the prefix, year style, and counter width of your permit numbers (e.g. SMB-2026-000056).</li>
          <li><b>Permit Certificate Details / Order of Payment Details</b> — the Mayor&rsquo;s and Treasurer&rsquo;s names as they should print on those two documents.</li>
          <li><b>Accepted Payment Methods</b> — which channels your LGU takes (cash, GCash, bank transfer, an online portal), each with its own details.</li>
          <li><b>SMS Usage</b> — how many texts you&rsquo;ve sent this month against the free allowance.</li>
          <li><b>SMS Notifications</b> — your own approved Sender Name, if you&rsquo;ve purchased one from Semaphore.</li>
        </ul>
      </KbCard>

      <KbCard title="Public Application Form">
        <p>The direct link (and embeddable code, for putting the form on your own municipal website) applicants use to apply online.</p>
      </KbCard>
    </KbSection>
  );
}
