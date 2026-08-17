-- "Returned to applicant" had no way out except the applicant actually
-- responding (2026-08-17) -- the project owner asked directly what
-- happens to one that never gets a response: it sits in BPLO's
-- dashboard forever (bplo/page.tsx's own query has no date filter at
-- all). Rather than guessing an auto-expiry timeout (this project's
-- standing rule against inventing an unconfirmed real-world number,
-- same reasoning the department-reminder escalation tier in section 10
-- is still left unset), this adds a manual BPLO action instead: Archive,
-- for when they've confirmed by phone or in person that the applicant
-- isn't proceeding. Reopen undoes it -- a plain status flip back, not a
-- one-way door, in case it was archived by mistake or the applicant
-- comes back later.
alter table applications drop constraint applications_status_check;
alter table applications add constraint applications_status_check
  check (status = ANY (ARRAY['submitted'::text, 'pending_bplo_initial'::text, 'pending_dept_review'::text, 'returned_to_applicant'::text, 'pending_bplo_assessment'::text, 'pending_payment'::text, 'pending_printing'::text, 'pending_mayor'::text, 'pending_release'::text, 'released'::text, 'rejected'::text, 'archived'::text]));

-- No new RLS policy needed -- migration 0002's existing "bplo can update
-- applications at their own lgu" UPDATE policy is already unscoped by
-- specific status values (RLS bounds rows, not which status transitions
-- are allowed within a row BPLO already has full access to).
