-- Splits the tail of the review workflow state machine into the real
-- number of steps a permit actually goes through after payment -- see
-- CLAUDE.md section 6 and section 7i for the full writeup. Previously,
-- Treasury's payment confirmation jumped straight to pending_mayor, and
-- the Mayor's own action both signed AND released the permit in one step
-- (signAndRelease). Two stages the project owner named were missing
-- entirely: printing the physical permit (between payment and the
-- Mayor's signature) and releasing it to the applicant (after the
-- signature, before the application is truly "released"). Neither
-- changes what already happened at each existing stage -- this only adds
-- two checkpoints in between.
--
-- New full sequence:
--   pending_payment -> pending_printing -> pending_mayor -> pending_release -> released

alter table applications drop constraint applications_status_check;
alter table applications add constraint applications_status_check check (status in (
  'submitted', 'pending_bplo_initial', 'pending_dept_review', 'returned_to_applicant',
  'pending_bplo_assessment', 'pending_payment', 'pending_printing', 'pending_mayor',
  'pending_release', 'released', 'rejected'
));

-- Audit trail for the two new BPLO-performed checkpoints, matching the
-- existing reviewer_id/reviewed_at-style pattern used elsewhere
-- (department_reviews, payments.received_by) rather than leaving these
-- transitions unattributed.
alter table applications add column printed_at timestamptz;
alter table applications add column printed_by uuid references staff_users(id);
alter table applications add column released_at timestamptz;
alter table applications add column released_by uuid references staff_users(id);
