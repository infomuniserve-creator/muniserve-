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

## 7a. Fee-rule seeding: resolved discrepancies and schema conventions

While writing the San Miguel seed script (`supabase/seed/seed_san_miguel_fee_rules.sql`), the two source-of-truth files turned out to diverge more than expected. Resolved with the project owner on 2026-08-11:

- **v1.2 JS is the confirmed baseline** (it's what the old GHL system actually charged). Where v1.2 and the v2.0 ChatGPT prompt doc conflict, v1.2 wins.
- **Mayor's Permit catch-all**: using v1.2's tiered ₱500 (new) / ₱150-₱250-₱350 (renewal, by prior LBT) structure. v2.0's flat ₱200 alternative is seeded but `is_active = false` — do not flip on without BPLO confirmation. (v2.0's own text on this point is internally inconsistent — see the seed script's section 15 comment.)
- **~25 special Mayor's Permit business types that exist only in v2.0** (Golf Link, Tobacco Dealer, itemized liquor types, Insurance Company vs. Agency split, etc.) are seeded with `is_active = false`. Flip individually once BPLO confirms San Miguel actually charges each one — don't bulk-activate.
- **CEDULA cooperative exemption**: the source doc contradicts itself (Section 7 says cooperatives pay CEDULA as a juridical entity; Section 9's "Legal Basis" summary says RA 9520 exempts them). Seeded assuming cooperatives **do** pay CEDULA (juridical formula) — Section 7's citation-backed reasoning (RA 9520 Art. 61 + LGC Sec. 133(n) cover LBT only) was judged more reliable than Section 9's one-line summary.

**Schema convention added:** migration `0003_fee_rule_bracket_rate_basis.sql` adds `fee_rule_brackets.rate_basis` (`'excess_over_min'` default, or `'full_amount'`) — needed because Schedules A/B/E's open-ended top bracket multiplies the *entire* basis by the rate, not just the excess over the bracket floor, which the original bracket shape couldn't express.

**Conventions documented in the seed script's header** (not yet reflected in the section 3 schema comments above — read the seed script itself for the full list): `basis_field = 'lbt_basis'` is a computed value the fee engine must derive (capital_investment if new, gross_sales if renewal), not a literal column; `fee_rule_brackets.max_amount` is exclusive except where a row comment says otherwise; `applies_to` uses a `key:variant` convention (e.g. `'commercial bank:branch'`) for rows that depend on `is_branch_office` or `is_aircon`, and `'standard:new'` / `'standard:renewal'` for the Mayor's Permit fallback when no special type matches; the essential-commodity discount's `applies_to` is a `|`-pipe-separated list since the column isn't an array.

**For the step 6 fee computation engine, when it gets built:** CEDULA's "per every X, or fraction" (section 7 of the CEDULA doc) means `CEIL(basis / formula_increment_per)`, not floor/truncate — the schema has the right numbers in `formula_increment_per`/`formula_base_fee`/`formula_increment_amount`/`formula_cap` but the ceiling-division behavior lives in the engine, not the data.

A known-but-not-fixed anomaly: v1.2's Food & Beverage / Amusement / Other LBT schedules have a real ~₱25 discontinuity in the original code at exactly `receipts = 100,000` (looks like a transcription slip, not an intentional rule). Seeded as continuous instead of preserving that one-point glitch — see the seed script's header note 7 if this ever needs auditing against the actual ordinance. **Update 2026-08-11: the actual ordinance text has this exact same discontinuity, worded the same way ("not over 100,000" / "over 100,000" as two separate brackets) — it's apparently in the real law, not a v1.2 transcription artifact. Still seeded as continuous; revisit if this one peso-exact value ever actually gets audited.**

## 7b. Corroborated against the actual scanned ordinance (2026-08-11)

The project owner provided a 17-page scan of San Miguel's actual Revenue Code (`reference/revenue-code-scans/`), not just the two derived documents. Reading the primary source instead of relying on derived summaries caught a real, material bug already live in the seeded data — this is now a standing rule for every future LGU, not just San Miguel:

> **Rule: never seed a new LGU's `fee_rules` from a derived/summary document alone (JS export, AI prompt doc, staff-written guide).** The actual ordinance/revenue code text is mandatory before activating anything for that LGU. Derived docs are fine as a first draft or cross-check, never as the sole source — see below for what that comparison missed.

**Fixed (migration `0004_new_business_lbt_rate.sql` + `seed/002_ordinance_corrections.sql`):**

- **New-business LBT was wrong for every one of the 9 schedules.** The ordinance's "Special Provisions" (page 23 of the scan) states that for a newly-started business, LBT = 1% of capital investment, floored at the schedule's minimum — a flat percentage-with-floor, completely different from the graduated bracket lookup v1.2 (and the original seed data) used for both new and renewal alike. Scope is Section 5 (a) through (i) — every LBT schedule except (j) Lessor. Fixed via a new `fee_rules.new_business_rate` column (see migration 0004's comment for the exact engine formula) rather than duplicating every schedule into new/renewal variants.
- **23 of the 24 "v2.0-only, unconfirmed" fees are now confirmed real and activated**: Skating Rink, Bowling Alley Non-Automatic, Boxing Stadium, Race Track, Pelota/Tennis Court, Golf Link, Mini Golf Link, Refrigeration Cases, Flammable Storage, Professional Principal Office, Insurance Company (principal/branch), all 8 liquor dealer types, Tobacco Dealer, Promoter/Sponsor, and the Liaison/Administrative Office tiered schedule — all found verbatim in the ordinance. Only the alternate flat-₱200 Mayor's Permit catch-all remains inactive (see below).
- **New fee items added** that neither v1.2 nor v2.0 had at all: Boxing Contest per fight (₱50), free special event permits for civic/religious/social orgs, Stage/Fashion Shows (₱100), Benefit Balls/Raffles/Bingo (₱100), fiesta "tienda" stalls (₱20), Dealer of Securities/Foreign Exchange (₱500), and a Carnival/Circus/Traveling Amusement per_unit rule (₱100 covers the first 10 operating days, ₱50/day after).

**Still open — not fixed, needs a decision before it matters:**

- **Essential-commodity discount eligibility list.** The ordinance defines this by 8 *commodity categories* (rice/corn; wheat-cassava-meat-dairy-preserved food-sugar-salt-agri/marine products; cooking oil/gas; laundry soap/detergent/medicine; agri implements/fertilizer/pesticide; poultry feed; school supplies; cement), not v1.2's list of specific business-name strings, which is what's actually seeded. Per the project owner's 2026-08-11 decision, v1.2's list stays as a working proxy for now rather than blocking on building a real category-to-business-type mapping — revisit with BPLO.
- **The disputed flat-₱200 Mayor's Permit catch-all** (ordinance section "2.21") really does exist in the text, but its relationship to the general tiered ₱500/₱150-250-350 rate is structurally ambiguous — it may be a separate/additional fee category (grouped near other event-style permits like stage shows and civic-event permits) rather than a replacement catch-all. Left inactive; needs a BPLO read on the actual numbered-section structure, not just "which number is right."
- **Cinema/Theater Mayor's Permit fee is under-modeled.** The ordinance bases it on orchestra/balcony/lodge tier (not just seating capacity + aircon, which is all v1.2/the current seed data uses). Not yet rebuilt.
- **Retailer LBT schedule has a confusing "more than P30,000" phrase** in the ordinance's own table header that contradicts its explanatory paragraph (which says the 2% rate applies to sales "not exceeding P400,000" with no 30,000 threshold mentioned). Possibly a scan/OCR artifact, possibly a real missing lower tier. Seeded as the simple 2-bracket version (no 30,000 threshold) pending clarification.
- **Memorial Park's hectare boundary**: the ordinance says "more than 2 hectares" (strictly `>`) for the ₱3,000 tier; the seeded data (following v1.2) uses `>= 2`. A one-value edge case, not fixed.
- **Disputed: cooperative Mayor's Permit exemption.** The scan's Section 4.02(b) reads as exempting RA 6938-registered cooperatives' manufacturing/exporting activities from the Mayor's Permit fee, not just LBT. The project owner pushed back on this reading (2026-08-11) — not confident it's actually applied that way in practice. Not implemented anywhere (no fee_rules row, no engine logic) and shouldn't be built until this is actually confirmed one way or the other.
- A reference to "paragraph X of Section 3" appears in the Manufacturer schedule's text (an exclusion clause) — Section 3 isn't in this 17-page scan. Unknown content, flag for whoever has the full document.

---

## 7c. San Miguel's real departments and the BFP payment quirk (2026-08-12)

`lgu_departments` is seeded with San Miguel's actual 5 reviewing departments — replacing the illustrative Zoning/Fire/MENRO/Engineering names used in the prototype and earlier draft of this doc, which were never confirmed real:

- **Engineering** (Municipal Engineering Office)
- **MHO** (Municipal Health Office)
- **MPDO** (Municipal Planning and Development Office)
- **BFP** (Bureau of Fire Protection)
- **MENRO** (Municipal Environment and Natural Resources Office)

**BFP's payment happens outside MuniServe entirely**, on BFP's own separate payment portal — not through this system's `payments`/Treasury flow at all. The real process: applicant pays on BFP's portal, screenshots the confirmation, and needs to get that screenshot to BFP so they can verify it before approving. BFP still reviews in the same parallel round as the other four departments (rule #4 is unaffected — no state-machine change needed) — it just won't click Approve until it can see that proof.

This is why the applicant needs a way to upload an *additional* document to an already-submitted application (not just at initial submission) — the payment screenshot isn't available at submission time, since the applicant usually hasn't paid BFP yet when they first apply. This also incidentally covers part of the "online resubmission isn't available yet" gap flagged in the status page (build order step 5): the upload mechanism is now real, even though the automatic BPLO-triggered resubmission notification is still a manual BPLO action, matching the prototype's design.

Staff dashboards (BPLO, department) need to actually display uploaded documents for this to work — not just know they exist, which is also true for the original 5 document types (a department can't meaningfully review "proof of business address" without seeing it). This wasn't built in step 4 (read-only, no documents shown) and is part of step 6's scope.

---

## 7d. The applicant form was built against the wrong source (2026-08-13)

`src/app/apply/page.tsx` (build order step 5) was built against `reference/MuniServe_Applicant_Flow_Prototype.html` — a mockup, not San Miguel's actual production intake form. The project owner surfaced the real form (`https://links.muniserve.ph/widget/form/LLkWXPS7wlzQ5bjDUSxZ`, a GoHighLevel widget) and it turned out to have roughly 3x the fields, most of them behind conditional show/hide logic the mockup never modeled at all.

The real form's exact configuration — all 68 field definitions and all 37 conditional rules — was extracted directly from the page's server-rendered data (not read visually) and saved to `reference/official-application-form/` (see that folder's `README.md`). **Treat this the same as the revenue-code scans in `reference/revenue-code-scans/`: the primary source, not a nice-to-have** — the same "never seed/build from a derived summary alone" rule from section 7b applies here too, just for form fields instead of fee rates.

The rebuild (migration `0009_official_application_form_fields.sql`, `src/lib/application-form-logic.ts`, `src/lib/san-miguel-form-options.ts`, `src/lib/business-profile.ts`, and the applicant/BPLO/department code that consumes them) added ~36 columns to `businesses`, one to `owners` (`gender`), one to `applications` (`declaration_accepted_at`), and a shared show/hide-rule evaluator so the client form and the server-side required-field check can't drift apart. Two added columns — `is_branch_office`, `is_aircon` — aren't new concepts: section 7a already named them as part of `fee_rules.applies_to`'s `key:variant` convention; they just had nowhere to be captured until now.

**Scope decisions worth knowing about before touching this again:**
- The applicant no longer self-selects an **LBT category** — the real form never asked for one either. `businesses.lbt_category` stays in the schema; BPLO gets a manual-override dropdown on the initial-review card (reusing the same `fee_rules` "LBT Schedule%" query) as a stopgap until the fee engine (build order step 7) can derive it from `nature_of_business` automatically. Don't remove that BPLO control until step 7 actually does this.
- `First Name`/`Last Name`/`Email` are collected once per owner (on first use, or on any owner still missing an email — including pre-existing owners from before this rebuild), not resubmitted with every application. `owners.full_name` stays a single joined column rather than splitting the schema.
- The perjury/data-privacy declaration is mandatory in this build even though the source form's own field is `required: false` — a deliberate, intentional deviation, not an oversight.
- One rule in the source form's own conditional logic is unimplementable literally (a 16-condition `isNotEqualTo`/`or` combination that, read as exported, would fire for every value including the ones it's supposed to exempt). It's replaced by a `defaultVisible = false` rule for exactly the fields it targets — see the comment at the top of `application-form-logic.ts` before changing that file's rule list.
- The essential-commodity discount mapping gap and the other open items in section 7a are unaffected by this — this section is about the applicant-facing form/schema, not fee computation itself.

---

## 7e. Staff dashboard redesign + Business Registry (2026-08-13)

The staff dashboards (`src/app/dashboard/**`) were flagged as "zero design, complicated" for non-technical BPLO/department/treasury/mayor staff. Redesigned to a card-based, soft-rounded, friendly-but-professional visual language, and given a real design-concept pass (an HTML mockup, approved before any code changed) rather than iterating blind in the actual app.

**Design system**, all in `src/app/globals.css`'s `@theme` block + `src/app/layout.tsx`:
- Typography: Quicksand (headings/display/numbers) + Nunito (body/UI), via `next/font/google` — replaced Geist. Applies app-wide, not just the dashboard, so the applicant-facing pages read as the same product.
- Palette: brand navy→teal gradient pulled from the marketing site, kept deliberately separate from the semantic good/warn/bad/info/cond colors used for status (a business/application's state should read at a glance regardless of the brand hue). Full light + dark tokens; dark mode follows `prefers-color-scheme`, no manual toggle in the real app (the mockup's toggle was a design-review aid only).
- Components live in `src/app/dashboard/ui.tsx` (Tailwind-based, replacing the earlier inline-style prototype port) — shared across all five dashboard pages so BPLO/department/treasury/mayor/Business Registry can't visually drift apart.

**Business Registry** (`src/app/dashboard/businesses/`) is new: a searchable, filterable list of every business on file, not just the ones with an application currently in flight — surfaced because BPLO had no way to just look up "is this business on file" without an active application, which matters since most of the 1,177 imported legacy businesses stay invisible until their owner claims them. Read-only for every staff role (RLS's existing "staff can view businesses/applications at their own lgu" policies from migration 0002 already cover this); a nav tab (Applications | Businesses) appears on every dashboard.

Status shown per business (`src/lib/business-status.ts`) isn't a stored column — it's derived from `is_legacy_unclaimed`/`is_active`, whether an application is currently in flight, and the latest `permits.valid_until` for that business (permits expire Dec 31 of the application year, per section 6/mayor's sign-and-release — that's the authoritative "is this permit current" check, not `application_year` alone). `in_progress` is a fifth bucket beyond the four in the original design concept, checked *before* legacy/inactive, so a business BPLO is actively mid-filing-for doesn't get mislabeled.

**Scope decisions from the design discussion, worth knowing about before touching this again:**
- BPLO can start a renewal (or a reactivation/"new" permit for an inactive business) on behalf of a walk-in owner directly from a registry row (`businesses/actions.ts`'s `startWalkInApplication`) — the counter-transaction case, someone who shows up in person instead of using the phone-OTP flow. Deliberately minimal: it does **not** re-collect the ~40-field profile (already on file; editing it is out of scope for this feature) — just the one figure that changes year to year (gross sales for a renewal, capital investment for new/reactivation).
- It skips `pending_bplo_initial` and opens the department round immediately (`initial_review_decision` is still recorded, pre-filled `approved`, for the audit trail) — BPLO is standing at the counter vouching for the documents right now, so there's no separate initial-review step left to do. The round-opening fan-out logic used to be duplicated inline in `bplo/actions.ts`; it's now shared via `review-workflow.ts`'s `openDepartmentReviewRound`.
- The walk-in form has an *optional* mobile number field. If given, it claims the business exactly like the self-service legacy-claim flow (find-or-create an `owners` row, link it) — without it, a legacy-unclaimed business stays `is_legacy_unclaimed = true` even after this filing (see the `in_progress`-before-`legacy` classification note above for why that's still displayed correctly), because flipping that flag without a phone on file would strand the real owner with no way to ever self-serve.
- New RLS policy, migration `0010_bplo_walkin_application_insert_policy.sql`: BPLO can now INSERT into `applications` at their own LGU (checking the referenced business belongs to that LGU too). Every `applications` row before this was created exclusively via the applicant-facing service-role route — there was no staff-side INSERT policy on `applications` at all.
- Full new-business walk-ins (no existing `businesses` row at all) are explicitly **not** handled by this feature — the registry only ever lists existing rows, so there's nothing to click for a business that isn't on file yet. Building a staff-facing equivalent of the full applicant wizard is separate future work, not done here.

---

## 8. UI reference

Two working HTML prototypes exist in `reference/` and should be treated as the source of truth for screen flow, not just visual style:

- `reference/MuniServe_Interactive_Prototype.html` — staff side: BPLO dashboard (initial review, assessment review, cross-department visibility), a generic department dashboard (locked to one department's queue), and the Mayor's signature queue. Demonstrates the access-control model directly — the "demo controls" bar in that file simulates switching logins; there is no equivalent control in the real product.
- `reference/MuniServe_Applicant_Flow_Prototype.html` — applicant side: new vs. renewal entry point, License Number lookup, phone/OTP verification, and the six-stage status tracker. **Not** the source of truth for the application form's actual fields or conditional logic — see `reference/official-application-form/` and section 7d for that; this mockup predates it and is a much smaller approximation.

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
