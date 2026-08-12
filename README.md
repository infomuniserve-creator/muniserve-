# MuniServe

Multi-LGU electronic Business Permit and Licensing System (eBPLS) for the Philippines, piloting with San Miguel, Bulacan.

See [`CLAUDE.md`](./CLAUDE.md) for the full build specification — non-negotiable rules, schema, RLS, workflow state machine, and build order. Read that before touching anything in here.

## Status

Live in production: Supabase, GitHub, Vercel, fee rules, legacy business data, and staff auth are all wired up and verified working end-to-end.

- [x] Next.js (App Router, TypeScript, Tailwind) scaffold
- [x] Database schema drafted — [`supabase/migrations/0001_initial_schema.sql`](./supabase/migrations/0001_initial_schema.sql)
- [x] RLS policies drafted — [`supabase/migrations/0002_rls_policies.sql`](./supabase/migrations/0002_rls_policies.sql)
- [x] `reference/` populated — fee computation source, HTML prototypes, legacy business data, and the unreconciled fee guide (see `reference/README.md` for what's in there and why)
- [x] Supabase project created and migrations run (schema + RLS both verified live)
- [x] GitHub repo created and pushed — [infomuniserve-creator/muniserve-](https://github.com/infomuniserve-creator/muniserve-)
- [x] Vercel project connected, deployed, env vars set
- [x] Seed script written and run against the live DB — `supabase/seed/seed_san_miguel_fee_rules.sql` (+ migration `0003_fee_rule_bracket_rate_basis.sql`). 112 fee_rules (88 active, 24 inactive pending BPLO confirmation), 139 fee_rule_brackets. See CLAUDE.md section 7a for discrepancies resolved while writing it.
- [x] Bulk-import legacy business roster into `businesses` — 1,177 imported (`bt_source='actual'`), 168 held out for manual review (`needs_review`, matches `BPLO_LBT_NeedsReview.csv`), 5 held out for missing license numbers (`no_match`). See `supabase/seed/legacy_business_import.sql`.
- [x] Staff auth + dashboards — Google OAuth via Supabase, verified end-to-end in production (real sign-in → `staff_users` lookup → role-routed → RLS-scoped queries). BPLO dashboard confirmed working live. Department and mayor dashboards share the same code path but haven't been tested with real accounts yet — provision a `staff_users` row for those roles when ready to check them too.
- [x] Applicant OTP flow + application form + legacy-claim flow — verified end-to-end live: real SMS via Semaphore, real OTP, real legacy business claimed (license 7094956), real application submitted as reference `MS-2026-00001`. Document upload code is untested via browser (file-picker automation limitation) but follows the same proven auth pattern as the rest of the applicant routes.
- [ ] Review workflow wiring ← **next**
- [ ] Fee computation engine
- [ ] Payments, permits, notifications

## What needs to happen before development continues

1. **Create the Supabase project** (supabase.com), then run the two migrations in `supabase/migrations/` in order via the SQL editor or `supabase db push`.
2. **Create a GitHub repo** and push this folder to it.
3. **Create a Vercel project** connected to that repo for auto-deploy on push.
4. **Env vars** — done for Supabase + Resend, both locally in `.env.local` and in Vercel. Still missing: `SEMAPHORE_API_KEY` (needed for step 5, applicant OTP flow — not urgent yet).

None of the above requires a code change — this is account creation and configuration, not something to script.
