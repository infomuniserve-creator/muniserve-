-- Closes a real, confirmed gap found during a full-system audit
-- (2026-08-20, security pass): send-otp/route.ts's only protection against
-- abuse was sendOtpCode()'s existing 30-second-per-PHONE-NUMBER cooldown --
-- nothing stopped one visitor from working through a list of many
-- different phone numbers, each burning a real, billed Semaphore SMS and
-- texting an unsolicited "verification code" to a real third party who
-- never asked for one. This table backs a simple per-IP-address throttle
-- (src/lib/rate-limit.ts) layered on top of the existing per-number
-- cooldown, not a replacement for it.
--
-- RLS enabled with deliberately NO policy -- same posture as
-- otp_codes/application_reference_counters (CLAUDE.md 7q's own "no policy
-- here means nobody but service-role can read this" convention): this
-- table is only ever touched via createServiceClient() from
-- src/lib/rate-limit.ts, never through a staff or applicant session.
create table otp_rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  created_at timestamptz not null default now()
);

alter table otp_rate_limit_events enable row level security;

create index otp_rate_limit_events_ip_created_at_idx on otp_rate_limit_events (ip, created_at);
