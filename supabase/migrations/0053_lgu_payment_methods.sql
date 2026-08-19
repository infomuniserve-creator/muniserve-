-- Accepted Payment Methods (2026-08-19) -- CLAUDE.md. Lets BPLO turn on
-- whichever payment channels their LGU actually accepts, each with its
-- own detail fields, so the payment-due notification/status page can
-- tell the applicant exactly how (and where) to pay instead of the
-- generic "pay at the Treasurer's Office." Multiple channels can be on
-- at once (the project owner's own confirmed choice -- an LGU can accept
-- cash AND GCash AND bank transfer simultaneously).
--
-- accepts_cash_counter defaults to true -- this is already today's real,
-- unconfigured behavior for every existing LGU (San Miguel, Cavite), so
-- nothing changes for them until BPLO deliberately reconfigures.
-- Everything else defaults off/blank, same "no generic fallback for a
-- real-world-specific fact" reasoning as mayor_name/treasurer_name --
-- there's no sensible default GCash number or bank account to guess.
alter table lgus
  add column accepts_cash_counter boolean not null default true,
  add column accepts_gcash boolean not null default false,
  add column gcash_number text,
  add column gcash_name text,
  add column accepts_bank_transfer boolean not null default false,
  add column bank_name text,
  add column bank_account_number text,
  add column bank_account_name text,
  add column accepts_online_portal boolean not null default false,
  add column online_portal_url text;
