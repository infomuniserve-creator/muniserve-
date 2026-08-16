-- Per-LGU SMS Sender Name (2026-08-16) -- lets an LGU that has purchased
-- and had a custom Semaphore Sender Name approved use it instead of the
-- account's shared default. Nullable, no generic fallback -- same shape as
-- lgus.mayor_name/treasurer_name (migrations 0033/0039): a client who
-- hasn't bought/registered one yet just sends under the account default,
-- with the existing "MuniServe: " text prefix kept as a substitute
-- identifier (notifications.ts now decides that centrally, based on
-- whether this column is set, rather than every call site hardcoding the
-- prefix itself).
--
-- Deliberately still a single SEMAPHORE_API_KEY/account for every LGU --
-- Semaphore's own API lets one account hold several approved Sender
-- Names and pick which one to use per message via a `sendername`
-- parameter (confirmed against semaphore.co/docs, not assumed), so this
-- is a per-message parameter, not a second API key or account per LGU.
alter table lgus add column sender_name text;

-- No new RLS policy needed: already covered by migration 0027's general
-- "bplo can update their own lgu's settings" policy (RLS bounds rows on
-- lgus, not columns), same as mayor_name/treasurer_name before it.
