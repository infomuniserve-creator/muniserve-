# revenue-code-scans/

The actual scanned San Miguel, Bulacan Revenue Code — 17 pages (page 7 through page 23 of the physical document; earlier pages weren't included in this scan). Provided by the project owner on 2026-08-11 specifically to verify the derived documents (`MUNISERVE_FeeComputation_v1.2.js`, `MuniServe_FeeComputation_ChatGPT_Prompt.md`) against the primary source.

Files are named by scan timestamp (`imgYYYYMMDD_HHMMSSxx.pdf`), not page number — sort by filename to get correct page order (verified against the page numbers printed on each scanned page).

**This corroboration pass found a real bug already live in the seeded fee_rules data** (new-business LBT was using the wrong formula for all 9 schedules) plus confirmed ~23 previously-"unconfirmed" fees as real. See CLAUDE.md section 7b for the full account, and `supabase/seed/002_ordinance_corrections.sql` for the fix.

**Pages covered:** 7-23, spanning Section 4 (Mayor's Permit Fees, all of 4.01 through 4.06) and Section 5 (Business Tax / LBT, subsections a-j plus Special Provisions). Section 3 is referenced once (an exclusion clause for Manufacturer schedule, "paragraph X of Section 3") but isn't in this scan — unknown content.

**Treat this as the authoritative source over both derived documents** for anything covered in these 17 pages. Where something in `fee_rules` still doesn't match this scan, it's tracked as an open item in CLAUDE.md section 7b, not silently resolved.
