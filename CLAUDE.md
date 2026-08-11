@AGENTS.md

# MuniServe — Build Specification for Claude Code

This is the master reference for building MuniServe: a multi-LGU electronic Business Permit and Licensing System (eBPLS) for the Philippines, starting with San Miguel, Bulacan as the pilot LGU.

It captures every architectural decision made during design, not just a feature list — read the "Non-negotiable rules" section closely, since these are the things that will silently break the product if a future change violates them.

---

## 1. Tech stack

- **Frontend + backend:** Next.js (App Router), single codebase for UI and API routes
- **Database + auth:** Supabase (Postgres + Row Level Security + Auth)
- **Hosting:** Vercel (connect GitHub repo, auto-deploy on push)
- **SMS:** Semaphore (existing account, used for OTP codes and status notifications)
- **Email:** Resend
- **File storage:** Supabase Storage (for uploaded documents, generated permit PDFs)

Why this stack: no server to manage, free to start, scales to any number of LGUs without infrastructure changes, and Claude Code has strong familiarity with all of it.

---

## 2. Non-negotiable rules

These were decided deliberately across a long design process. Do not "simplify" these away without checking back — each one exists because of a real failure mode we designed around.

1. **No fee, rate, or business-type logic may be hardcoded in application code.** Every fee (Mayor's Permit, LBT, CEDULA, Health Card, Signboard, anything) is a row in the `fee_rules` table, scoped to one LGU. Onboarding a new LGU or changing a rate must never require a code change or deploy — only new rows.
2. **Renewal applications never create a new owner record.** Only a genuinely new applicant creates a new `owners` row. A renewal always resolves to an existing `businesses` row (see the legacy-claim flow in section 5).
3. **One owner can have multiple businesses.** Identity is phone-number-first (email second), not per-business. Deduplicate on phone/email, not on business.
4. **Department review is parallel, not sequential.** Once BPLO completes its initial review, every active department for that LGU is notified simultaneously. They do not wait on each other.
5. **If one department rejects or requests more info, the others still finish their review.** Never halt the whole round because one department responded negatively — BPLO needs the complete picture.
6. **On resubmission, only the department(s) that rejected or requested more info re-review.** Departments that already approved are not re-triggered. This is why `department_reviews` is scoped per review round, not a single status per department per application.
7. **Only BPLO can override a computed fee amount.** Treasury is a read-only checkpoint for fee amounts — their role is to confirm payment and record an OR number, never to adjust what's owed.
8. **Department staff can only see and act on their own department's queue.** A MENRO login must never be able to view or act on Zoning's pending applications, and vice versa. This must be enforced at the database layer (RLS), not just hidden in the UI.
9. **BPLO staff can see and act on every department's queue, including submitting a decision on a department's behalf.** When they do, the decision must be tagged with who actually made it (see `acted_on_behalf` in section 4) so there's an audit trail distinguishing a real department decision from a BPLO proxy decision.
10. **No passwords for applicants.** Identity verification is phone-number OTP (primary) or email OTP (secondary). Applicants should never need to "remember an account" for something they use once a year.
11. **Some fees may not be collected online at all.** Each `fee_rules` row has a `delivery_mode`: `online` (computed and paid in-system), `reference_only` (computed and shown, but paid at a physical counter), or `external` (not computed by the system — just a required uploaded document, e.g. some LGUs require CEDULA to be secured in person).

---

## 3. Database schema

Run this against a fresh Supabase project. This is a first pass — expect to add indexes and tighten constraints as you build, but the shape and relationships should not change without a good reason.

See `supabase/migrations/0001_initial_schema.sql` for the runnable version of this schema.

---

## 4. Row Level Security — enforcing access control in the database, not the UI

Rule 8 above ("a MENRO login must never see Zoning's queue") has to be enforced where it can't be bypassed by a UI bug — at the database layer.

See `supabase/migrations/0002_rls_policies.sql` for the runnable policies. Apply the same shape of policy to `application_fee_lines` (only `role = 'bplo'` may write `overridden_amount`), `payments` (only `role = 'treasury'` may insert), and `permits` (only `role = 'mayor'` may insert an `issued_at`). Every table that stores a decision or a money amount needs a policy — don't rely on API-route checks alone.

---

## 5. Applicant identity & the legacy data bridge

San Miguel's imported historical business records have **no phone number or email** — they only have a `License No.` (confirmed unique, never reused). This means the first online renewal for any pre-existing business is a "claim" event, not a normal login:

1. Returning applicant chooses "Renew" and enters their existing License Number (printed on their last permit/receipt)
2. System looks up `businesses` by `legacy_license_no`, shows a masked confirmation ("Is this your business?")
3. On confirmation, applicant enters a phone number for the first time — this gets attached permanently to that `businesses.owner_id`
4. Every renewal after this first one works purely on phone-number OTP, no License Number needed

For a genuinely new application, skip the License Number step entirely — go straight to phone entry. If the phone number matches an existing `owners` row, confirm identity and attach the new business to that owner (this is how one person ends up with three businesses under one contact instead of three duplicate contacts).

Both flows are fully mocked in `reference/MuniServe_Applicant_Flow_Prototype.html` — build against that reference for exact screen sequencing and copy.

---

## 6. Review workflow state machine

```
submitted
  → pending_bplo_initial        (BPLO reviews documents for legitimacy)
    → returned_to_applicant     (BPLO rejects or requests info at this stage)
    → pending_dept_review       (BPLO approves — fans out to every active department at once)
      → pending_dept_review     (loops here on partial resubmission — only rejecting depts re-notified)
      → pending_bplo_assessment (once ALL active departments approve/approve-with-condition)
        → pending_payment       (BPLO finalizes fee assessment, can override amounts)
          → pending_mayor       (Treasury confirms payment received, cannot alter fees)
            → released          (Mayor signs, permit PDF + QR generated)
```

Each pass through `pending_dept_review` is one row in `review_rounds`. `department_reviews` rows belong to a round, so round 2 only creates rows for the departments that need to re-review — the ones that already approved in round 1 are not touched.

Notification rules to implement:
- 24-hour reminder to a department reviewer if their `department_reviews.decision` is still `pending`, skipping Saturday/Sunday
- Immediate notification to both the applicant and BPLO the moment any department sets `decision` to `rejected` or `request_more_info` — don't wait for the other departments
- An escalation tier beyond the first reminder is recommended (e.g. notify the department head after 3 business days) but the exact timing should be confirmed against your LGU's obligations under RA 11032 (Ease of Doing Business Act) before hardcoding a number

---

## 7. Seeding San Miguel's fee rules

The actual LBT schedules (A through J), Mayor's Permit special business types, essential-commodity discount list, and CEDULA formula are already fully documented from the legacy system — don't re-derive them. Use these as source data when writing the seed script that populates `fee_rules` and `fee_rule_brackets` for San Miguel:

- `MUNISERVE_FeeComputation_v1.2.js` — every LBT schedule and Mayor's Permit special-type rate, as exact JS logic (translate each bracket into a `fee_rule_brackets` row rather than reimplementing as code)
- `MuniServe_FeeComputation_ChatGPT_Prompt.md` — the same data in prose/table form, useful for cross-checking the seed script got every rate right
- `MUNISERVE_DOC_CEDULA_Calculation.html` — the CEDULA formula and caps (₱5,005 individual / ₱10,500 juridical), maps to `computation_type = 'formula_increment'`

All three are now in `reference/` — see `reference/README.md` for provenance notes (v1.2 was originally a GoHighLevel Code Action; the peso amounts/brackets are still the valid legacy revenue code, the GHL wrapper is not).

Flag for follow-up rather than guessing: the Health Card / Signboard / Weights-and-Measures fees and the Senior/PWD/BMBE discount logic described in the newer "Assessment Calculation Setup Guide" (now `reference/unreconciled/muniserve_new.docx`) were never reconciled with the legacy fee computation code — confirm with the LGU which of these San Miguel actually charges before seeding them as active `fee_rules`. Also unconfirmed: the legal basis for applying Senior Citizen/PWD discounts to Mayor's Permit Fee and Business Tax specifically (these laws typically govern consumer purchases, not permit fees paid by a business owner) — do not enable that `fee_rules` type for any LGU until counsel confirms.

### Legacy business record import (not in the original spec — added because the data exists)

`reference/legacy-data/BPLO_LBT_Backfill_v2.csv` (1,350 rows) is San Miguel's real legacy business roster — the actual data the `businesses.legacy_license_no` bridge in section 5 needs to work against. `BPLO_LBT_NeedsReview.csv` (168 rows) is a flagged subset that needs manual review before import — don't bulk-import those without checking each one. This wasn't in the original build order; it belongs as its own step (bulk-load `businesses` with `is_legacy_unclaimed = true`, `owner_id = null`) before the applicant-facing renewal flow (step 4) can be tested against real data instead of fixtures.

---

## 8. UI reference

Two working HTML prototypes exist in `reference/` and should be treated as the source of truth for screen flow, not just visual style:

- `reference/MuniServe_Interactive_Prototype.html` — staff side: BPLO dashboard (initial review, assessment review, cross-department visibility), a generic department dashboard (locked to one department's queue), and the Mayor's signature queue. Demonstrates the access-control model directly — the "demo controls" bar in that file simulates switching logins; there is no equivalent control in the real product.
- `reference/MuniServe_Applicant_Flow_Prototype.html` — applicant side: new vs. renewal entry point, License Number lookup, phone/OTP verification, the application form with conditional fields, and the six-stage status tracker.

---

## 9. Suggested build order

Don't build all of this in one pass. Sequence:

1. Supabase project + run the schema above + RLS policies
2. Seed script for San Miguel's `fee_rules` and `fee_rule_brackets`
3. Bulk-import San Miguel's legacy business roster (`reference/legacy-data/BPLO_LBT_Backfill_v2.csv`) into `businesses` as `is_legacy_unclaimed = true`, `owner_id = null` — needed before step 5 can be tested against real data. Hold out `BPLO_LBT_NeedsReview.csv` rows for manual review, don't auto-import them.
4. Staff auth (Google OAuth via Supabase) + the three dashboard views, read-only first (no decision buttons yet)
5. Applicant phone/OTP flow + the application form, including the legacy-claim flow (section 5) against the imported roster
6. Wire up the review workflow state machine end-to-end (this is where `review_rounds` and `department_reviews` logic lives)
7. Fee computation engine — a function that reads active `fee_rules` for an LGU and computes `application_fee_lines` from an application's `form_inputs`
8. Payments, permit PDF generation, notifications (SMS via Semaphore, email via Resend)

---

## 10. Open items to confirm before/while building

- Escalation timing for unresponsive department reviewers (recommended, not yet finalized)
- Whether RA 11032's mandated processing windows should drive any automatic status changes, or remain purely a reporting/escalation input (recommend the latter — no auto-approval without a human in the loop)
- Legal basis for applying Senior Citizen/PWD discounts to Mayor's Permit Fee and Business Tax specifically (these laws typically govern consumer purchases, not permit fees paid by a business owner) — confirm with counsel before enabling that `fee_rules` type for any LGU
- Whether Treasury needs a dashboard of its own (not yet mocked up — likely a short one: view assessed amount, record payment method/OR number, done)
