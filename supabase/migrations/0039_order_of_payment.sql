-- Order of Payment (2026-08-16) -- the itemized assessment slip BPLO
-- prints/emails for the applicant to bring to Treasury, built against a
-- real San Miguel physical form. See CLAUDE.md for the full design
-- discussion and the fields deliberately left blank (CTC #, SSS No.,
-- SEC/DTI Date Issued -- nothing in MuniServe captures these today).
--
-- Acct Code -- the LGU's own municipal revenue-code numbering (e.g.
-- "605-1" for Mayor's Permit Fee, "582" for Business Tax). Nullable/
-- optional -- ships empty, filled in per fee rule once BPLO has the real
-- codes (never invented here, same standing rule against guessing an
-- LGU's own real-world figures already applied to fee rates/legal
-- citations elsewhere). Denormalized onto application_fee_lines at
-- finalize time, same reasoning fee_category/display_label already are
-- (migration 0026) -- a reprint of a past assessment must show the code
-- that was true THEN, not whatever a since-edited fee_rules row says now.
alter table fee_rules add column acct_code text;
alter table application_fee_lines add column acct_code text;

-- Who actually finalized this assessment -- mirrors the existing
-- initial_review_by/printed_by/released_by attribution columns.
-- Assessment finalization never got one of these despite being the stage
-- most in need of it: the Order of Payment's "Assessed by" signature line
-- needs a name that's still correct on a reprint months later, and
-- audit_log's own actor_label is a point-in-time text snapshot, not a
-- queryable FK back to staff_users.
alter table applications add column assessment_finalized_by uuid references staff_users(id);

-- Mode of Payment (Annual / Semi-Annual / Quarterly), chosen by BPLO at
-- the moment of finalizing -- printed on the Order of Payment.
-- Deliberately its own column, not reused from businesses.business_tax_payment
-- (the applicant's own stated preference on their form, which can drift
-- after this specific assessment is already finalized) -- same "freeze
-- what was true at this moment" reasoning as the columns above.
alter table applications add column mode_of_payment text
  check (mode_of_payment in ('Annual', 'Semi-Annual', 'Quarterly'));

-- Treasurer's name -- prints on the Order of Payment's "Reviewed &
-- Recommended for Approval" line. A plain Settings field, no workflow
-- gate behind it (confirmed with the project owner) -- same shape as
-- lgus.mayor_name (migration 0033).
alter table lgus add column treasurer_name text;

-- No new RLS policies needed: fee_rules.acct_code on regulatory rows is
-- already covered by migration 0027's "bplo can manage regulatory fees"
-- (ALL, not per-column); lgus.treasurer_name by 0027's own general "bplo
-- can update their own lgu's settings"; assessment_finalized_by/
-- mode_of_payment are written via finalizeAssessment's existing
-- service-role client, same as the rest of that function's writes.
