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
          → pending_printing    (Treasury confirms payment received, cannot alter fees)
            → pending_mayor     (BPLO confirms the physical permit is printed)
              → pending_release (Mayor signs — permit + permit_history rows created here)
                → released      (BPLO confirms the signed permit was handed to the applicant)
```

See section 7i for why `pending_printing`/`pending_release` exist and who performs each one — this diagram was originally shorter (`pending_payment → pending_mayor → released` directly) before that pass.

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

**Bug found live-testing the real form (2026-08-13):** "Submit application" looked completely unresponsive. It wasn't unresponsive — it was **silently disabled**. The button's `disabled` condition only checked 3 of the form's ~30 required fields (business name, nature of business, the declaration checkbox), and plain inline styles give a disabled `<button>` no visual difference from an enabled one, so a legitimately-disabled button (anything else required still empty) looked identical to a broken one. Fixed two ways: the button now only disables on `loading` and just lets the existing server-side `missing_required_fields` validation tell the applicant exactly what's missing (via `fieldLabel()`, so the error says "Registration authority" instead of the raw `registrationAuthority` key) instead of guessing a partial client-side gate; and added a real `disabledBtnStyle` (dimmed + `cursor: not-allowed`) applied everywhere a button's `disabled` prop can be true, so a genuinely-disabled button never looks clickable again. Verified the mechanism directly (toggling the phone field to flip a disabled button's computed `opacity`/`cursor` in the browser preview) since OTP-gated screens can't be reached without a real phone number to test through.

**A second, more serious bug, found immediately after (same day):** once the button fix let a real submission actually happen, the error correctly listed ~14 missing required fields (Business name, TIN, the whole address block, Business activity, CEDULA, ...) that the applicant said they couldn't even see on the form to fill in. Root cause: `application-form-logic.ts`'s `computeVisibleFields()` only ever populates its returned Set with fields that are actually referenced by one of the 37 conditional rules (`RULE_TOUCHED_FIELDS`) — the ~25 fields that were never conditional in the first place (they're just supposed to always show) never get added to that Set at all. `apply/page.tsx`'s `renderField()` was checking `!visibleFields.has(fd.key)` against that Set directly, which reads as "hidden" for every field the Set never mentions — silently hiding roughly half the form. The library's own exported `isFieldVisible(field, values)` exists specifically to answer "is this one field visible" correctly (it returns `true` immediately for anything outside `RULE_TOUCHED_FIELDS`); `submit-application/route.ts`'s server-side validation already used it correctly via `isFieldCurrentlyRequired`, which is exactly why the server kept reporting those fields as missing while the client never rendered them. Fixed by switching `apply/page.tsx` to call `isFieldVisible()` per field instead of testing Set membership. Verified directly against the real library code with the exact reported scenario (New application, Piggery/Hog Raising, same operation address, owned premises) — confirmed all ~14 fields flip from incorrectly-hidden to correctly-shown.

Same session, same page: the signature pad required an explicit "Save signature" click, which read as broken to someone expecting it to just work after signing. Now auto-saves ~900ms after the pen lifts (reset on every new stroke, so it doesn't upload a half-finished signature between letters) — the manual button stays too, relabeled "Save now," as an immediate option.

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

Live-testing the redesign on the deployed site immediately surfaced three real gaps, fixed same-day: the top bar sat flush against the browser's own chrome (no page-level padding anywhere — fixed with a shared `src/app/dashboard/layout.tsx` every dashboard route now sits inside); nav-tab clicks felt unresponsive with nothing on screen during the fetch (fixed with `src/app/dashboard/loading.tsx`, a skeleton Next.js shows automatically during the navigation); and dark mode had no visible control (the mockup's toggle never made it into the real app, deliberately, at the time — reconsidered once actually asked about it, so now there's a real one, `theme-toggle.tsx`, scoped to `#dashboard-shell` via a `theme` cookie + `[data-theme]` attribute selectors in `globals.css`, layered on top of the plain `prefers-color-scheme` default rather than replacing it).

## 7f. Permit History (2026-08-13, same day)

Second view added to the Businesses section, alongside the card-based Directory above — a dense, sortable/filterable historical table, `src/app/dashboard/businesses/history/`, built to match a reference dashboard the project owner shared pixel-for-pixel (colors, layout, filters, stats, badges, CSV export). Directory answers "what does this business need right now"; Permit History answers "show me every permit ever issued" — different enough questions that they stay two views (`sub-nav.tsx`) rather than one page trying to do both.

**Data provenance, important if this ever needs re-importing or explained to someone else:** the reference file was a client-side page that called GoHighLevel's API directly from the browser using a hardcoded Private Integration Token, against a pipeline holding **13,548 real San Miguel permit records, 2020–2026**. Two things followed from that:
- The API key was flagged to the project owner as exposed and in need of rotation if that file was ever shared outside their own machine — it is **not** reproduced anywhere in this repo.
- Only the data (row values + lookup tables) was extracted, cleaned of any credentials/fetch code, and committed as `supabase/seed/permit_history_san_miguel.json` (~1.6MB) + a one-time Node import script (`supabase/seed/import_permit_history.mjs`, run once against production, not an app feature) — deliberately a Node+service-role script rather than the usual pasted-SQL-file pattern, since 13,548 rows of SQL text is impractical to paste through the SQL editor's Monaco instance the way every other migration in this project has been run.

**Schema**: a new standalone `permit_history` table (migration `0011_permit_history.sql`), not a backfill into `applications` — these are raw historical facts about permits issued through whatever process predated MuniServe, not MuniServe-mediated workflow records (no review rounds, no department reviews, none of that ever happened for these; forcing them into `applications` would imply a review history that never occurred). `business_id` is nullable, linked best-effort by matching `legacy_license_no` against `businesses`. `category`/`owner_type`/`pay_frequency`/`gender` are free-standing text columns rather than reusing `businesses.lbt_category` or the applicant-form picklists — the source uses its own coarser taxonomy (4 categories vs. ~200 nature-of-business values) and forcing a 1:1 mapping between two different classification systems would misrepresent one or the other.

**Bug caught while building this, fixed in two places:** Supabase/PostgREST caps a single response at 1,000 rows by default, silently. The businesses→license lookup used during import only ever saw the first 1,000 of San Miguel's 1,177 businesses on the first pass (fixed with a follow-up `UPDATE ... WHERE business_id IS NULL`); the **Business Registry Directory's own businesses query had the identical bug already shipped** — same fix applied there too. Both now go through a shared `src/lib/db-pagination.ts` `fetchAllRows()` helper that loops with `.range()` instead of trusting a single call. Any future query expected to return more than 1,000 rows needs to use it.

`fetchAllRows()` originally paged *sequentially* (await page 1, then page 2, ...) — for Permit History's 13,548 rows that's 14 round trips to Supabase back to back before the page can render anything, which is exactly what made switching to it feel "unusually long" compared to a tool that isn't re-fetching data on every navigation. Fixed to fetch every page in parallel once it knows the total count (`{ count: "exact" }` on the first request): measured directly against production, Permit History's fetch went from ~4.8s to ~1.1s, Directory's from ~740ms to ~230ms. Every caller of `fetchAllRows()` needs `{ count: "exact" }` in its `.select()` for this to work — it silently falls back to "just the first page" without it.

**Design note**: this page intentionally uses smaller border radii and a denser layout than the rest of the dashboard (which favors soft, rounded, spacious cards) — a reporting/audit view for scanning thousands of rows has different needs than a workflow queue, and the project owner asked for this specific look. Colors are pulled from the shared design tokens (not literal hex values) wherever close enough, specifically so the dashboard's dark-mode toggle still works here; two tokens (`--color-male`/`--color-female`) were added for the gender-breakdown stat cards, the one pair the existing palette didn't already cover.

**Follow-up, same day — "is Directory still needed once Permit History exists?"** Discussed directly: yes, they answer different questions (Directory: what does this business need right now, including the only walk-in action; Permit History: what's ever happened), but Permit History as shipped was a frozen 2020–2026 snapshot — nothing wrote to it going forward, so it would have quietly drifted out of date the moment MuniServe started releasing real permits. Fixed (`mayor/actions.ts`'s `signAndRelease`, migration `0012_permit_history_insert_policy.sql`): every sign-and-release now also appends a `permit_history` row, through the Mayor's own RLS-scoped session (new policy: mayor, own LGU, no extra join needed since `lgu_id` here is always server-derived from the authenticated session, never client input). `category` stays null on these MuniServe-originated rows — no equivalent classification exists on a real application, and mapping `nature_of_business` to the historical source's 4-bucket taxonomy isn't something to guess at (same standing rule as 7b/7d). `pay_frequency` gets normalized at insert time (`businesses.business_tax_payment`'s "Annual" → the historical log's own "Yearly") so the Permit History filter dropdown doesn't end up with two spellings of the same thing — `businesses.business_tax_payment` itself is untouched by this, only what gets written into `permit_history`.

## 7g. Fee computation engine (build order step 7) (2026-08-13, same day)

`src/lib/fee-engine.ts`. Before writing a line of it, re-verified the fee-rule status against the live database rather than trusting this document's own memory of it — good thing: what got told to the project owner mid-conversation ("24 rules still inactive, essential-commodity discount unconfirmed") was **stale and wrong**. The real state, confirmed live: only one rule is inactive (the disputed flat-₱200 catch-all, correctly excluded), and the Essential Commodity Discount has been active since the very first seed script. Corrected before scoping the engine, not after.

**The matching model** — every application computes at most four lines, not "which of 118 rules apply":
- **LBT schedule line** — matched by `businesses.lbt_category` against an active `LBT Schedule%` rule's `applies_to` (confirmed against `lbt-categories.ts`: that's literally what BPLO's manual-override dropdown writes there). Basis is `lbt_basis` (capital investment if `new`, gross sales if `renewal` — computed, not a column, per 7a). A `new` application on a rule with `new_business_rate` set uses `basis * rate` floored at that schedule's lowest bracket, **not** a bracket lookup (7a's ordinance-correction note #1) — a `renewal` uses the normal bracket lookup (`min_amount <= basis < max_amount`, and `rate_basis: 'full_amount'` vs. `'excess_over_min'` for Schedules A/B/E's open-ended top bracket).
- **Essential-commodity discount** — fires when the business's nature-of-business is in the rule's `|`-piped list *and* the LBT rule that just computed is one of `discount_target_fee_rule_ids` (confirmed by checking the actual three target IDs: LBT Schedules A/B/D). A flat 50% off that line, as its own negative `application_fee_lines` row rather than mutating the LBT line — keeps both amounts individually visible/auditable.
- **Mayor's Permit line** — a business-type-specific rule if one matches (`applies_to`'s `key:variant` convention: `:branch`/`:principal` off `is_branch_office`, `:aircon`/`:nonaircon` off `is_aircon`), else the `standard:new`/`standard:renewal` fallback. The other ~110 active rules besides the LBT schedules and CEDULA are all just candidates for this one slot.
- **CEDULA** — matched by `organization_type` (`'individual'` for Sole Proprietorship, `'juridical'` otherwise), `formula_increment` with ceiling division (`CEIL(basis / formula_increment_per)`, per 7a), capped, and marked `included_in_total = false` since `delivery_mode = 'reference_only'` (rule #11 — computed and shown, paid at the counter, not part of the online total).

**A real bug caught by testing against production, not guessed away:** `per_unit` rules (Security Agency, Billiard Hall, Carnival) have a base `flat_amount` *plus* the per-unit rate — Security Agency is "₱300 principal + ₱50/locality," not just ₱50/locality. First draft only multiplied the rate, undercharging every per-unit rule. Caught by running the engine against real `fee_rules` with six synthetic scenarios (a Node script run with `--experimental-strip-types`, not committed) before this ever reached BPLO's screen — the fix is `flat_amount + per_unit_rate * count`.

**Real data gaps, flagged rather than guessed a value for:**
- **Missing LBT category** blocks the whole assessment with a message linking to the Business Registry (the project owner's explicit choice, over "compute everything else and skip just that line") — nothing else can be computed without it anyway.
- **Liquor sub-type** (`wholesale_foreign`/`retail_tuba`/etc. — 8 variants) and **Carnival/Circus operating days beyond 10** have no capturing field anywhere on the applicant form. These specific lines get flagged for manual assessment; nothing else on the application is blocked by it.
- **"Prior year LBT paid"** (the Standard Renewal Mayor's Permit's own tiering basis, ₱150/₱250/₱350) has no real per-business history yet — this pilot's first year on MuniServe. Approximated with *this year's* just-computed LBT amount rather than reaching into `permit_history`'s lump-sum `amount_paid` (which conflates Mayor's Permit + LBT + other fees from the historical source into one number — a worse proxy, not a better one). Low-stakes either way: a ~₱200 spread across three tiers. Flagged with a note on the line, not silently decided.
- **`organization_type` is null** on some real businesses (legacy import gap) — CEDULA defaults to the juridical formula (the larger of the two amounts) rather than guessing individual, and since CEDULA is `reference_only`, this never silently changes what's actually collected online.

**Where it's wired**: BPLO's assessment card (`bplo/page.tsx`'s `AssessmentCard`) computes a **live preview** every render — nothing touches `application_fee_lines` until "Finalize assessment" is submitted, which re-runs the computation server-side (never trusts the page's own preview, since hidden form fields are technically client-editable) and applies only the `override_<feeRuleId>`/`overrideReason_<feeRuleId>` inputs, which are the ones actually meant to be edited (rule #7). Treasury's page now shows the real assessed breakdown and total instead of a blind entry field, with the amount input still free-text and still required (a business can legitimately pay a different amount than assessed).

---

## 7h. Identity fields moved onto the main applicant form (2026-08-13, same day)

7d's decision — collect First Name/Last Name/Email once via a separate "identity" screen, keyed off the phone-OTP step — turned out not to match the real form after all. The project owner shared screenshots of the actual live GoHighLevel form: it shows First Name, Last Name, Email, Mobile Phone, and Owner's Gender directly on the main form itself, in an "Owner / Representative Info" section between Main Office Address and Business Operation, on *every* submission — not a one-time separate step.

**Reversed 7d's decision accordingly.** `src/app/apply/page.tsx`'s standalone `"identity"` screen and `submitIdentity()` are gone; the same five fields now render inline on the `"form"` screen's own "Owner / representative info" section, pre-filled from `verify-otp`'s response (blank for a genuinely new owner) and editable on every submission, per the project owner's explicit choice ("Show on the main form, editable every time... submitting the form also updates their owners record, not just this one application"):
- **First Name / Last Name / Email / Gender** are real, editable inputs — a typo'd email or a legal-name update goes through cleanly on any submission, not just the first one.
- **Mobile Phone** is shown but **read-only** — a deliberate deviation from pixel-matching the real form, not an oversight. Phone is the OTP-verified session identity itself (how MuniServe knows who's filling out the form at all); silently letting it be edited inline would decouple the displayed number from the actual verified session, with no re-verification step to back it up. Changing your registered number is a different, more sensitive operation than fixing a typo'd email, and isn't handled by this form at all (use "Start over" to sign in with a different number).
- `verify-otp/route.ts` now returns `ownerEmail`/`ownerGender` (previously only `ownerName`) so the form can pre-fill them; the `needsIdentity` flag and all its branching are gone — every path now goes straight to `"form"` (or `"owner_match"`/`"business_picker"` as before), never to a separate identity step.
- `submit-application/route.ts` now validates `firstName`/`lastName`/`email` as ordinary required fields (matching what the client already enforces via the shared `REQUIRED_FIELDS`/`isFieldCurrentlyRequired` from `application-form-logic.ts` — no more `OWNER_IDENTITY_FIELDS` carve-out) and writes them back to the `owners` row on every successful submission. `phone` stays required-but-not-client-supplied: the route injects a non-blank placeholder for the shared required-field check rather than trusting a client-submitted value, since `ownerId` already having a session guarantees a real phone is on file.
- `/api/applicant/update-name` is deleted — it only ever existed to serve the now-removed identity screen.

**Also addressed the same day, from the same screenshots** — the project owner noted "the rest of the uploads only shows when all required fields has been filled up," matching the real form's own progressive disclosure. `apply/page.tsx` now computes `readyForDocuments` (every currently-required, currently-visible, non-document field has a value) and hides the entire Documents-to-submit / Signature / Declaration / Submit block behind it, showing a plain "fill in the required fields above" notice instead. Document fields themselves are excluded from that check (nothing can be uploaded to a section that isn't shown yet), and `declarationAccepted` isn't a prerequisite for showing its own checkbox.

Not yet done, flagged for later rather than guessed: the real form's screenshots show "Business Premises Ownership" *without* a required asterisk, which may conflict with `premisesOwnership` currently being in `REQUIRED_FIELDS` — worth checking against `reference/official-application-form/fields.json` directly before changing it either way. Also out of scope here: the real form's two-column field grid and Cloudflare bot-protection widget — this pass was about field placement/data-flow correctness, not a pixel-parity visual rebuild (a fair follow-up if wanted, but a separately-scoped one).

**Follow-up, same day — the LGU letterhead banner was still missing.** The project owner caught that the real form's header (Republic of Philippines / Province of Bulacan / Municipality of San Miguel Bulacan / Office of the Municipal BPLO, plus "Unified Application Form for Business Permit / Tax Year <year>") hadn't actually been added anywhere. Added as `LguBanner()` in `apply/page.tsx`, rendered once above every screen (not just the form step) rather than per-screen like `Head`. Tax year is `new Date().getFullYear()`, not a hardcoded "2026" — it won't need a manual edit every January. **Flagged, not yet fixed:** "Municipality of San Miguel Bulacan" is hardcoded text in that component. Fine for this single-LGU pilot, but the moment a second LGU onboards, this needs to read from the LGU's own record instead of being baked into the component — noted here so it isn't forgotten, not fixed yet since MuniServe is still single-tenant in practice.

---

## 7i. Two missing pipeline stages: printing and release (2026-08-13, same day)

The project owner flagged two problems with the staff-facing pipeline (`WorkflowStepper` in `dashboard/ui.tsx`, rendered on every application card across BPLO/department/treasury/mayor): the BPLO dashboard's own stat-card row listed "Assessment review" *before* "In dept. review" — wrong order, a bug carried over verbatim from `reference/MuniServe_Interactive_Prototype.html`'s own stat-card ordering (line 145 of that file has the same bug) — and the pipeline was missing two real stages entirely: **printing** the physical permit and **releasing** it to the applicant. The full corrected sequence, as given: Initial Review → Departments Review → Assessment Review → Treasurer Approval → For Printing → Mayor's Signature → For Release → Released.

This wasn't just a labeling fix — printing and release are real checkpoints that didn't exist anywhere in the state machine before this. Previously, Treasury's payment confirmation (`recordPayment`) advanced straight to `pending_mayor`, and the Mayor's own action (`signAndRelease`) both signed *and* released in one step. Split via migration `0013_printing_release_pipeline_stages.sql`, which adds `pending_printing`/`pending_release` to `applications.status`'s check constraint plus `printed_at`/`printed_by`/`released_at`/`released_by` audit columns (same reviewer_id/reviewed_at-style pattern used elsewhere):

- **Treasury's `recordPayment`** now advances `pending_payment → pending_printing` instead of straight to `pending_mayor`.
- **New: BPLO's `markPrinted`** (`pending_printing → pending_mayor`) — a plain confirmation, no judgment call involved, just "the physical permit is printed and ready to go to the Mayor." Uses BPLO's own RLS-scoped session, same as `submitInitialReview`.
- **Mayor's action, renamed `signAndRelease` → `signPermit`**, now advances `pending_mayor → pending_release` instead of `→ released`. The `permits` row and the `permit_history` append still happen here, at signing — that's genuinely when the permit is legally issued; release is just the physical hand-off, so there's no reason to move that side effect to the later step.
- **New: BPLO's `markReleased`** (`pending_release → released`) — the actual final step, confirming the signed permit was handed to the applicant. No new side effects beyond the status flip + audit columns, since `permits`/`permit_history` were already written at signing.

**Who owns printing and release** was a judgment call, not specified by the project owner — decided rather than asked, since both are front-counter mechanics BPLO already owns (they run initial review and assessment; Treasury and the Mayor's roles stay exactly as narrow as before, one action each). Worth revisiting if it turns out Treasury or a records office actually handles printing in practice.

**Everywhere the pipeline is displayed, updated to match:**
- `dashboard/ui.tsx`'s `WorkflowStepper`: 8 steps now (was 7 — "Submitted" was dropped as its own step, since `submit-application/route.ts` creates every application already at `pending_bplo_initial` and that status value is essentially never observed on a real row).
- `status/[reference]/page.tsx` (the applicant-facing tracker): also updated to the same 8 real statuses, with plainer applicant-facing wording ("Printing your permit," "Ready for release") instead of the staff dashboard's more literal internal terms ("For Printing," "Treasurer Approval") — these are two different audiences reading the same underlying state, not one pipeline description reused verbatim. This was a required fix, not optional polish: without it, an application sitting in the two new statuses would have shown a blank/stuck progress bar to the applicant (`currentIdx` not found in the old 5-stage list).
- `dashboard/businesses/page.tsx`'s `APP_STATUS_LABEL` map: added labels for both new statuses (has a raw-status fallback, so this wasn't strictly required, but keeping every status labeled is the existing convention).
- BPLO's dashboard gained two new sections, "Ready to print" and "Ready to release" — simple confirm-and-advance lists (`Row` + a single button), not full review cards, since neither step involves a decision.

**Also fixed, same request:** the dashboard shell (`dashboard/layout.tsx`) wrapped every staff page in `max-w-3xl` (768px) — the project owner asked to "maximize the width" since review cards (business profile grid, document lists, the now-8-step pipeline) felt constricted. Widened to `max-w-7xl` (1280px).

**Follow-up, same day — BPLO's stat-card row was still missing two stages.** The first pass only added stat cards for stages BPLO directly acts on (Initial/Assessment review, printing, release), so "Treasurer Approval" and "Mayor's Signature" had no count anywhere on BPLO's dashboard even though they're real, named stages in the pipeline the project owner gave. Added both (`awaitingPayment`/`awaitingSignature` filters on `pending_payment`/`pending_mayor`) as stat-card-only entries — no action queue underneath, since BPLO doesn't act on either (Treasury and the Mayor each own their own dashboard for that). Reasoning: BPLO is the one office that should see the *entire* pipeline end to end, not just its own actionable slice. `StatGrid`'s auto-fit minimum width was also tightened from 140px to 120px so all 8 cards still fit in one row at the dashboard's current 1280px width instead of wrapping to two.

**Follow-up, same day — stat card colors.** The project owner also asked for the stat cards themselves (not just the small icon chip) to carry a color matching their status. `StatCard` now applies `bg-{tone}-bg`/`text-{tone}-ink` to the whole card. Tone means "what kind of stage," not literally "how urgent": warn = BPLO has to make a judgment call (approve/reject/assess); info = waiting on someone else (departments, Treasury, Mayor) or a simple physical confirmation with no judgment involved (printing/release); good = done. Eight stages, five real tones — the overlap is intentional grouping, not a missed distinction.

---

## 7j. Notifications (build order step 8, part 1) (2026-08-13, same day)

Picked back up at build order step 8 ("Payments, permit PDF generation, notifications") — payments were already mostly done (Treasury's `recordPayment`, `application_fee_lines`), so this pass covers the notifications half. Permit PDF/QR generation is next, deliberately split out: the project owner confirmed there's no real BPLO permit template to match (unlike everything else in this project so far), so it needs its own design pass rather than being guessed at inside this same change.

**New infrastructure:**
- `src/lib/resend.ts` — `sendEmail()`, same minimal fetch-based shape as the existing `src/lib/semaphore.ts`. `RESEND_FROM_EMAIL` is a new required env var, deliberately **not** a hardcoded domain — Resend requires the sending address to be on a domain verified in that account's Domains tab, which isn't something to guess at from code. `.env.local` has a placeholder (`notifications@muniserve.ph`) that will make `sendEmail()` fail loudly (never silently) until it's swapped for a real verified address in both `.env.local` and Vercel's project env vars.
- `src/lib/notifications.ts` — `notifyApplicantSms()` and `notifyStaffEmail()`, the only two entry points every call site uses. Both are best-effort by design: log to `notifications_log` (migration 0001 already had this table + RLS, unused until now) as `sent` or `failed`, but never throw either way. A notification failure (bad number, provider outage) must never block or roll back the workflow action that triggered it — Treasury recording a real payment can't fail because Semaphore is down.
- `src/app/api/cron/department-reminders/route.ts` + `vercel.json` — the 24-hour department reminder CLAUDE.md section 6 already specified. Runs once daily (`0 1 * * *`, Vercel Cron), authenticated via `CRON_SECRET` (new env var, generated and added to `.env.local`; **must also be added to Vercel's project env vars** for the deployed cron to actually authenticate). Skips the entire run on Saturday/Sunday, computed in Asia/Manila time rather than the server's own UTC day (which can disagree with PH-local weekday depending on time of day). Uses `department_reviews.reminder_sent_at`/`escalated_at` — both columns existed since migration 0001 and were unused until now, so this was clearly anticipated in the original schema design.
- **Escalation tier deliberately not implemented.** Section 10 already flagged this as unconfirmed pending the LGU's/counsel's read on RA 11032 — hardcoding "3 business days" (CLAUDE.md's own example number) would be exactly the kind of unconfirmed-real-world-fact guess this project's standing rule warns against elsewhere (fee rates, form fields, letterhead text). `escalated_at` stays unused until that number is actually confirmed.

**Applicant-facing SMS**, beyond the one CLAUDE.md explicitly required (department reject/request-info) — added at every point where the ball moves into or out of the applicant's hands, a judgment call flagged here rather than silently assumed:
- BPLO returns the application during initial review (`bplo/actions.ts`'s `submitInitialReview`)
- A department rejects or requests more info (`review-workflow.ts`'s `submitDepartmentDecision` — the one explicitly required by section 6; also emails every active BPLO staff_user at the LGU, since there's no single "BPLO inbox" to address instead)
- Assessment finalized — tells the applicant the actual total due, using each line's *final* amount (override if BPLO set one, not the pre-override `result.total`) (`bplo/actions.ts`'s `finalizeAssessment`)
- Payment received, permit now printing (`treasury/actions.ts`'s `recordPayment`)
- Permit released (`bplo/actions.ts`'s `markReleased`)

Deliberately stopped there — "permit printed, sent to Mayor" and "Mayor signed, ready for release" were considered and left out: both sit between two already-notified endpoints (payment received vs. released) and would add SMS volume without giving the applicant anything actionable to do with the information.

---

## 7k. Permit PDF + QR generation (build order step 8, part 2) (2026-08-13, same day)

Finishes build order step 8. No real BPLO permit template exists to match (confirmed with the project owner), unlike everything else built so far — this is a from-scratch design (`src/lib/permit-pdf.ts`), explicitly a reasonable first draft, not a pixel-locked final.

**Libraries**: `pdf-lib` + `qrcode`, both pure-JS with no native dependencies (no Puppeteer/Chromium) — runs in a Vercel serverless function with zero extra configuration, unlike most PDF-from-HTML approaches.

**Layout**: letterhead matching `apply/page.tsx`'s `LguBanner` (same hardcoded-LGU-name limitation flagged in 7h applies here too — not re-fixed twice), permit number, a details table (business name, owner/representative, nature of business, address, application type, dates), certifying body text, a QR code + "Scan to verify," and a Mayor's signature line.

**QR code links to a new public page, `/verify/[reference]`** — deliberately unauthenticated, unlike `/status/[reference]`. The whole point of a QR code on a physically posted permit is that anyone scanning it (an inspector, a customer) can confirm it's real without being signed in as the applicant. Shows only business name, permit number, dates, and a Valid/Expired badge — nothing financial, nothing personally identifying beyond the business's own name (already posted publicly on the permit itself). Uses the service-role client, since there's no owner session to scope a normal RLS-authenticated read to on a public page.

**Storage**: new `permit-pdfs` bucket (migration `0014_permit_pdfs_bucket.sql`), **public** — a deliberate contrast with the private `application-documents` bucket (migration 0007). Once signed, a permit is meant to be freely downloadable/shareable, and the QR verification link only works if the PDF (and QR image) it points at doesn't require auth either. Uploads still only ever happen via service-role server code (`signPermit`) — public means public *read*, not public write.

**Wired into `mayor/actions.ts`'s `signPermit`**, right after the `permits` row insert: generates both assets, uploads them, then updates that same row's `pdf_url`/`qr_code_url`. Wrapped in try/catch, not left to throw — the permit is already legally issued the moment the insert above succeeds, so a PDF renderer or upload bug must never undo or block the actual signature. A failure here just leaves both URLs null (logged via `console.error`) until retried or fixed, rather than rolling back a real signed permit. `/status/[reference]` shows a "Download permit (PDF)" link once `released`, falling back to "pick up at the BPLO counter" if `pdf_url` is still null for any reason.

**A real bug caught before shipping, not after**: the first draft rendered `valid_until` (`2026-12-31`) as "December 30, 2026" on the actual generated PDF — verified by rendering a real test PDF and reading it back, not by inspecting the code and assuming it was right. Root cause: a date-only string parses as UTC midnight, and formatting that instant in a negative-UTC-offset timezone rolls it back a calendar day. Fixed two ways: date-only strings now parse at noon UTC (far enough from midnight that no real-world offset can roll it over), and every display format call now pins an explicit `timeZone: "Asia/Manila"` rather than trusting whatever timezone the process happens to be running in (Vercel's functions run in UTC, but this shouldn't silently depend on that). Applied to both `permit-pdf.ts` and the new `/verify/[reference]` page, which had the same class of issue in its own expiry-instant construction (`new Date("...T23:59:59+08:00")` now, an explicit offset rather than an unqualified local-time string).

**New env vars, needed before this can run against production**: `NEXT_PUBLIC_APP_URL` (the deployed site's own base URL, used server-side to build the QR code's verification link — a server action has no request Host header to derive this from) — generated/placeholder'd in `.env.local`, must also be set in Vercel's project env vars.

---

## 7l. Custom domain: portal.muniserve.ph (2026-08-13, same day)

The project owner already owns `muniserve.ph`, with a subdomain (`links.muniserve.ph`) pointing at their existing GoHighLevel account — the real production intake form section 7d/8 reference. Rather than buy a second, unrelated-sounding domain, added `portal.muniserve.ph` as a new subdomain pointing at this app's Vercel deployment (CNAME to `cname.vercel-dns.com`), leaving GHL's own records on the domain untouched — DNS records are per-hostname, not per-domain, so this doesn't conflict with anything already there.

**A real gotcha hit and fixed**: staff Google sign-in worked, but always landed back on `muniserve.vercel.app` regardless of which domain the flow started from. Not an app bug — `login/page.tsx` and `auth/callback/route.ts` both already build their redirect dynamically from the actual request origin, no hardcoded domain anywhere. The cause was Supabase Auth's own **Redirect URLs allowlist** (Authentication → URL Configuration): only `muniserve.vercel.app` was on it, so Supabase silently fell back to its configured default Site URL instead of honoring the dynamic `redirectTo`. Fixed by adding `https://portal.muniserve.ph/**` to Redirect URLs and updating Site URL to match — a config change, not a code change. Worth remembering if a third domain ever gets added: this allowlist, not the app, is what needs updating.

`NEXT_PUBLIC_APP_URL` (7k) should be kept in sync with whichever domain is primary going forward.

---

## 7m. Staff account management UI (2026-08-13, same day)

Closes a real operational gap, not a bug: migration 0002's own comment on `staff_users` said outright *"nobody edits this from the client (provisioning is an admin/service-role task)"* — a deliberate original decision that meant onboarding a new department reviewer, treasury clerk, or mayor account required direct database access. The project owner asked for this over two other candidates (permit renewal reminders, multi-LGU fixes) specifically because it was the one blocking normal operation without me.

**Who administers staff was a judgment call, not specified — decided rather than asked**, same reasoning as 7i's printing/release ownership: BPLO already runs the most administrative surface of this whole system (walk-in filings, LBT overrides, acting on any department's behalf), so it's the natural fit. Revisit if that turns out wrong in practice.

**Self-service claim by email, not a manual auth_user_id lookup.** A brand-new staff member has no Supabase `auth.users` row (and thus no `auth_user_id`) until they've signed in with Google at least once — so BPLO can't provision a fully-linked account up front, only an email-keyed placeholder. `addStaffMember` (`staff/actions.ts`) inserts a `staff_users` row with `auth_user_id = null`; `/auth/callback/route.ts` now claims it automatically on that person's first real sign-in, matching by email (case-insensitive `ilike`, since Google's returned casing doesn't have to match whatever BPLO typed). This is the standard "invite by email, they claim it by signing in" pattern, not something invented for this project.

**Migration `0015_staff_management.sql`**: reverses migration 0002's original stance for BPLO specifically — new INSERT/UPDATE policies scoped to `lgu_id = current_staff()`'s own LGU and `role = 'bplo'`. Also adds `unique (email)` on `staff_users` (checked production first: zero duplicates existed, only one staff row total) so the claim-by-email lookup is unambiguous. RLS bounds which *rows* BPLO can reach, not which *columns* — `setStaffActive` only ever writes `is_active`, never touching role/lgu_id/email itself, even though the UPDATE policy's `WITH CHECK` alone wouldn't stop that.

**Guard against locking out staff management entirely**: `setStaffActive` refuses to deactivate a `bplo`-role account if it's the last *active* one at that LGU — otherwise deactivating the wrong account would mean nobody left with a UI path to reactivate anyone, right back to needing direct database access. RLS has no way to express "not the last one," so this is checked in application code.

Never a hard delete — `is_active` toggle only, matching the rest of this schema's soft-delete convention (`businesses.is_active`, `lgu_departments.is_active`).

Scoped down deliberately: adding a staff member and activating/deactivating them, not full profile editing (role/department reassignment after creation) — reassigning a department mid-flight risks orphaning in-progress `department_reviews` rows tied to the old department name, not something to allow casually from a simple admin form.

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
