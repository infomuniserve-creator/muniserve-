import { KbCard, KbRow, KbSection, KbShot, KbTip, MiniTopBar } from "./kb-ui";

export function GettingStartedSection() {
  return (
    <KbSection id="getting-started" icon="👋" title="Getting Started" sub="The basics before anything else — how to sign in, and who sees what.">
      <KbCard title="Signing in">
        <p>
          MuniServe uses your office Google account — there&rsquo;s no separate MuniServe password to remember. Go to the
          sign-in page and choose <b>Sign in with Google</b>, using the exact email address BPLO added you with. If it
          says you&rsquo;re not set up yet, ask BPLO to add you first (Settings &rarr; Staff &amp; Access).
        </p>
      </KbCard>

      <KbCard title="The four staff roles">
        <p>What you see and can do depends on your role:</p>
        <ul>
          <li><b>BPLO</b> — reviews every new/renewal application first, sets fees, and can see everything every other role sees too (including acting on a department&rsquo;s, Treasury&rsquo;s, or the Mayor&rsquo;s behalf when needed).</li>
          <li><b>Department</b> (Engineering, MHO, MPDO, BFP, MENRO, or whichever your LGU has) — reviews applications only for your own department. You can&rsquo;t see another department&rsquo;s queue, even by accident — the system itself blocks it.</li>
          <li><b>Treasury</b> — records payments once BPLO has finalized the fees. Never adjusts what&rsquo;s owed.</li>
          <li><b>Mayor</b> — signs permits once every earlier step is complete.</li>
        </ul>
        <KbTip>Every department reviews at the same time, not one after another — one department rejecting or asking for more info never stops the others from finishing theirs.</KbTip>
      </KbCard>

      <KbCard title="A tour of the top bar">
        <KbShot caption="The top bar looks the same everywhere in the dashboard — only the tabs shown change by role.">
          <MiniTopBar officeLabel="BPLO Office" active="Applications" />
        </KbShot>
        <ul>
          <li><b>Applications / Businesses</b> — always there. Audit Trail and Stats &amp; Reports only show up for BPLO and the Mayor.</li>
          <li><b>⚙️ gear icon</b> — Settings. BPLO only.</li>
          <li><b>🌗 sun/moon icon</b> — switches light/dark mode for your own screen.</li>
          <li><b>Knowledge Base</b> — this page, opens in a new tab so your dashboard stays open behind it.</li>
          <li><b>Circle with your initials</b> — click it to see your name and Sign out.</li>
        </ul>
      </KbCard>
    </KbSection>
  );
}

export function PipelineSection() {
  return (
    <KbSection id="pipeline" icon="🗂️" title="The Review Pipeline" sub="Every application moves through the same 8 stages, in the same order, every time.">
      <KbCard>
        <div className="-mx-1 flex flex-wrap gap-1.5 py-1">
          {["Initial Review", "Dept. Review", "Assessment", "Payment", "Printing", "Mayor's Signature", "Release", "Released"].map((s, i) => (
            <div key={s} className="min-w-[90px] flex-1 rounded-xl border border-border bg-surface-2 px-1.5 py-2.5 text-center text-[10.5px] font-bold text-ink-soft">
              <span className="mx-auto mb-1.5 flex size-5 items-center justify-center rounded-full bg-brand-navy text-[10px] text-white">{i + 1}</span>
              {s}
            </div>
          ))}
        </div>
      </KbCard>

      <KbCard title="Stage 1 — Initial Review (BPLO)">
        <p>BPLO checks that a new or renewal application is legitimate and complete before anyone else sees it. Four choices:</p>
        <ol>
          <li><b>Approve</b> — moves on to every active department at once.</li>
          <li><b>Approve with condition</b> — moves on, but your note travels with the application so departments know what to watch for.</li>
          <li><b>Request more info</b> — sends it back to the applicant with your note; they get an SMS and email, and re-submitting brings it straight back here.</li>
          <li><b>Reject</b> — closes the application for good (the applicant is told and it moves to Archived).</li>
        </ol>
        <KbTip tone="warn">Notes are required for anything except a plain Approve — the form won&rsquo;t let you submit without one.</KbTip>
        <KbTip>An application can&rsquo;t move into department review without an LBT category set on the business first. If Approve is greyed out, set the category right there on the card (or in Businesses if it&rsquo;s not showing).</KbTip>
      </KbCard>

      <KbCard title="Stage 2 — Departments Review">
        <p>
          Every active department gets the application at the same time. Each department&rsquo;s own reviewer sees only
          their own queue and makes the same four decisions Initial Review does. Once every department has approved
          (or approved with condition), it automatically moves on to Assessment — nobody has to push it along.
        </p>
        <p>
          If your LGU has BFP as a department, applicants are told separately that the Fire Safety Inspection Fee is
          paid directly to BFP, not through MuniServe — see <a href="#notifications" className="text-info-ink underline underline-offset-2">What Applicants Are Told</a>.
        </p>
      </KbCard>

      <KbCard title="Stage 3 — Assessment (BPLO)">
        <p>
          Once every department has cleared, BPLO finalizes the actual fees due — Local Business Tax, Mayor&rsquo;s
          Permit Fee, any regulatory fees, CEDULA, and (if enabled) Engineering&rsquo;s own assessed Building Permit
          Fee. BPLO can override any computed amount with a reason, and picks the mode of payment for a renewal
          (Annual, Bi-Annually, or Quarterly) — a new application always pays the full year upfront.
        </p>
        <KbShot caption="The itemized breakdown shown to BPLO before clicking Finalize assessment.">
          <div className="rounded-xl border border-border p-3">
            <KbRow label="Local Business Tax" value="₱4,400.00" />
            <KbRow label="Mayor's Permit Fee" value="₱2,000.00" />
            <KbRow label="Regulatory Fee" value="₱300.00" />
            <KbRow label="Total due online" value="₱6,700.00" />
          </div>
        </KbShot>
      </KbCard>

      <KbCard title="Stage 4 — Payment">
        <p>
          Treasury records the payment (amount, method, OR number) once it&rsquo;s received. BPLO can also record a
          payment on Treasury&rsquo;s behalf if an applicant pays in person and brings the receipt straight to BPLO
          instead. Neither role can change what&rsquo;s owed here — only Assessment can do that.
        </p>
      </KbCard>

      <KbCard title="Stages 5–7 — Printing, Mayor's Signature, Release">
        <p>
          Three simple confirm-and-advance steps, all owned by BPLO in the real day-to-day process: mark the physical
          permit as printed, carry it to the Mayor for a wet signature (or sign on the Mayor&rsquo;s behalf if that&rsquo;s
          how your LGU actually works), then confirm it&rsquo;s been handed to the applicant. The permit is legally
          issued the moment it&rsquo;s signed — release is just the physical hand-off.
        </p>
      </KbCard>

      <KbCard title="Returned, Rejected, and Archived">
        <p>
          &ldquo;Returned to applicant&rdquo; and &ldquo;Archived&rdquo; sections sit below the main queues on BPLO&rsquo;s
          dashboard, collapsed by default. Use <b>Archive</b> to close out an application that&rsquo;s stalled
          anywhere in the pipeline (not just Returned) — it can always be reopened later from the Archived list if the
          applicant comes back.
        </p>
      </KbCard>
    </KbSection>
  );
}

export function BusinessesSection() {
  return (
    <KbSection id="businesses" icon="🏢" title="Businesses" sub="Every business on file, whether or not it currently has an application in progress.">
      <KbCard title="Business Registry">
        <p>
          Search and filter every business on record, not just ones mid-application. Each row expands to show the full
          profile, every past application, and (BPLO only) controls for LBT category, claiming/unlinking an owner, and
          starting a walk-in filing.
        </p>
        <ul>
          <li><b>Active</b> — has a currently valid permit.</li>
          <li><b>Needs renewal</b> — permit has expired.</li>
          <li><b>Legacy — not claimed</b> — an imported historical record nobody has linked a phone number to yet.</li>
          <li><b>In progress</b> — an application is currently moving through the pipeline.</li>
          <li><b>Inactive</b> — marked closed.</li>
        </ul>
      </KbCard>

      <KbCard title="Walk-in filing (existing business)">
        <p>
          For a business already on file, BPLO can file a renewal or reactivation right from its Registry row — only
          asking for the one figure that changes every year (gross sales for a renewal, capital investment for a new
          or reactivated permit). It skips straight to department review, since BPLO is vouching for the paperwork in
          person. A genuinely brand-new business with no existing record still needs the full online form — see the
          Knowledge Base&rsquo;s note on walk-ins for new applicants for how to handle that at the counter.
        </p>
      </KbCard>

      <KbCard title="Claiming, unclaiming, and phone changes">
        <p>
          A legacy business becomes self-service the moment a phone number is attached to it — either the owner does
          this themselves online, or BPLO can do it in person (Business Registry &rarr; claim). If an owner loses
          their number, BPLO can update it directly; if a business was linked to the wrong person entirely, BPLO can
          unlink it and it becomes claimable again.
        </p>
      </KbCard>

      <KbCard title="Permit History">
        <p>
          A separate, denser table for a different question — not &ldquo;what does this business need right now&rdquo;
          (that&rsquo;s the Registry), but &ldquo;show me every permit ever issued.&rdquo; Sortable, filterable, and
          exportable to CSV.
        </p>
      </KbCard>
    </KbSection>
  );
}
