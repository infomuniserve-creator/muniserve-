-- Business Tax installment payments (2026-08-19) -- CLAUDE.md. A New
-- application always pays the full annual Local Business Tax; only a
-- Renewal can choose Bi-Annually (half now, the other half reminded
-- Jul 5) or Quarterly (a quarter now, the other three reminded Apr 5 /
-- Jul 5 / Oct 5 -- the standard LGC quarterly schedule). Reminder dates
-- are LGU-configurable (Settings), not hardcoded -- the project owner's
-- own words: "I'm not sure if other LGUs are doing the same dates."
-- San Miguel's real dates are seeded directly below since they're a
-- known, confirmed fact for the pilot LGU, not a guess.

alter table lgus
  add column lbt_biannual_reminder_dates text[], -- 'MM-DD' strings, e.g. {'07-05'}. Null/empty = not configured yet, no reminders sent.
  add column lbt_quarterly_reminder_dates text[]; -- e.g. {'04-05','07-05','10-05'}

update lgus
  set lbt_biannual_reminder_dates = array['07-05'],
      lbt_quarterly_reminder_dates = array['04-05', '07-05', '10-05']
  where name = 'San Miguel';

-- Reminder-only (project owner's own explicit choice) -- no online payment
-- of the remaining installments in this pass, so no balance/schedule
-- tracking beyond "has this specific reminder been sent yet." The
-- per-installment amount is snapshotted at creation (finalizeAssessment,
-- from the exact same application_fee_lines LBT row BPLO's own screen
-- showed) so a later fee-rule edit can't retroactively change what a
-- reminder claims is due -- same "denormalize at the moment of truth"
-- convention as application_fee_lines.display_label/acct_code.
create table business_tax_reminders (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  lgu_id uuid not null references lgus(id),
  reminder_date date not null,
  amount numeric not null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- The daily cron's own scan shape: "every reminder due today or earlier
-- that hasn't been sent yet."
create index business_tax_reminders_pending_idx on business_tax_reminders(reminder_date) where sent_at is null;

-- RLS enabled, deliberately no policy at all -- same posture as
-- otp_codes/application_reference_counters (CLAUDE.md 7q's own follow-up:
-- "no policy" here means "nobody but service-role can read this," the
-- correct posture for a table only ever touched by finalizeAssessment
-- (insert) and the new reminder cron (select/update), never by a staff
-- or anon session -- confirmed with the project owner before building,
-- not assumed.
alter table business_tax_reminders enable row level security;
