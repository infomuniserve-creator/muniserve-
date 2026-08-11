# reference/

Source material pulled from the design-process outputs folder. Everything here was cross-checked against `MuniServe_Build_Spec.md` (now `CLAUDE.md`) before being copied in — this folder had many superseded drafts (an earlier GoHighLevel-based build attempt, older fee-computation versions, generated guides, email correspondence) that were deliberately left out. See the conversation log for the full triage if you need to know why something isn't here.

## Files

- **`MUNISERVE_FeeComputation_v1.2.js`** — every LBT schedule and Mayor's Permit special-type rate as JS logic. **Use as data source only** — translate each bracket into a `fee_rule_brackets` row per CLAUDE.md rule #1, don't port the code itself. (Note: this file was originally written as a GoHighLevel "Code Action" — the underlying peso amounts/brackets are the legacy revenue code and are still valid; the GHL wrapper around them is not.)
- **`MuniServe_FeeComputation_ChatGPT_Prompt.md`** — the same fee data in prose/table form, for cross-checking the seed script got every rate right.
- **`MUNISERVE_DOC_CEDULA_Calculation.html`** — CEDULA formula and caps (₱5,005 individual / ₱10,500 juridical). Maps to `computation_type = 'formula_increment'`.
- **`MuniServe_Interactive_Prototype.html`** — staff-side screen flow (BPLO, department, mayor dashboards). Source of truth for screen sequencing, not just visuals.
- **`MuniServe_Applicant_Flow_Prototype.html`** — applicant-side screen flow (new/renewal, License Number lookup, OTP, application form, status tracker).

### legacy-data/

Real San Miguel legacy business records, not yet used by any build step in the original spec — added because it's the actual data the `businesses.legacy_license_no` bridge (CLAUDE.md §5) needs to work against.

- **`BPLO_LBT_Backfill_v2.csv`** (1,350 rows) — the superseding version (adds a `bt_source` column over v1, which was left out).
- **`BPLO_LBT_NeedsReview.csv`** (168 rows) — a flagged subset that needs manual review before import; don't bulk-import these without checking each one.

**Not yet imported anywhere.** See the added build-order step in CLAUDE.md §9.

### unreconciled/

- **`muniserve_new.docx` / `.txt`** — the "Assessment Calculation Setup Guide" referenced in CLAUDE.md §7 and §10. Describes Health Card, Signboard, Weights-and-Measures fees and Senior/PWD/BMBE discount stacking rules that **were never reconciled against the legacy fee computation code** and whose legal basis (for the discounts, specifically) hasn't been confirmed with counsel. **Do not seed any `fee_rules` from this document without that confirmation.** Kept here so it's on hand once that conversation happens, not as an active source.
