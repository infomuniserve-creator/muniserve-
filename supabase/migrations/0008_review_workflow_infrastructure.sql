-- Infrastructure for wiring the review workflow state machine
-- (build order step 6) end-to-end.

-- ============================================================
-- 1. BPLO's initial-review decision needs somewhere to live
-- ============================================================
-- department_reviews captures per-department decisions once fanned out,
-- but there was nowhere to record BPLO's own initial legitimacy-check
-- decision (approve / approve with condition / request more info /
-- reject) or their reasoning -- important for an applicant who gets
-- returned to know what to fix, and for an audit trail of who decided
-- and when. Mirrors department_reviews' shape (decision, notes,
-- reviewer, timestamp) but lives directly on applications since there's
-- exactly one reviewer for this stage, not one row per department.

alter table applications
  add column initial_review_decision text
    check (initial_review_decision in ('approved', 'approved_with_condition', 'request_more_info', 'rejected')),
  add column initial_review_notes text,
  add column initial_review_by uuid references staff_users(id),
  add column initial_review_at timestamptz;

-- ============================================================
-- 2. review_rounds was missing an INSERT policy entirely
-- ============================================================
-- Migration 0002 only gave staff a SELECT policy on review_rounds --
-- nobody, not even BPLO, could actually create one through their own
-- RLS-scoped session. Caught while wiring up BPLO's "approve initial
-- review, fan out to departments" action, which needs to insert the
-- review_rounds row before it can insert the department_reviews rows
-- into it.

create policy "bplo can create review rounds for their lgu's applications"
on review_rounds for insert
with check (
  exists (
    select 1 from applications a
    where a.id = review_rounds.application_id
      and a.lgu_id = (select lgu_id from current_staff())
      and (select role from current_staff()) = 'bplo'
  )
);
