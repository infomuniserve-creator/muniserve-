-- SMS usage counter (2026-08-19, CLAUDE.md) -- the project owner provides
-- 1000 free SMS/month per municipality (no carryover), Php 0.55 each over
-- that. Building an accurate counter first required closing a real gap:
-- OTP sends (the single largest real SMS volume driver -- every login,
-- renewal, and status re-verification requires one) never wrote a
-- notifications_log row at all, and had no LGU attached anywhere in the
-- data model even conceptually (sendOtpCode(phone) took no lgu context).
--
-- lgu_id is denormalized directly onto notifications_log at insert time
-- (same "denormalize at the moment of truth" convention as
-- application_fee_lines.display_label/acct_code) rather than derived via
-- application_id at read time -- application_id is null for several real
-- notification types already (OTP sends, the staff welcome email), so a
-- join-based derivation would silently miss exactly the rows this
-- feature most needs to count.
alter table notifications_log add column lgu_id uuid references lgus(id);

-- RLS: this table has been enabled with zero policies since migration
-- 0001 (CLAUDE.md 7q's own follow-up confirmed this by design -- writes
-- only ever happen via createServiceClient()). Two new, additive SELECT
-- policies for the two places this counter needs to be read from: BPLO
-- at their own LGU (Settings), and any active platform admin across
-- every LGU (/admin). Neither widens who can write.
create policy "bplo can view notifications_log at their own lgu"
  on notifications_log for select
  using ((select current_staff.role from current_staff()) = 'bplo' and lgu_id = (select current_staff.lgu_id from current_staff()));

create policy "platform admins can view notifications_log"
  on notifications_log for select
  using (exists (select 1 from platform_admins where auth_user_id = auth.uid() and is_active = true));
