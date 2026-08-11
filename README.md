# MuniServe

Multi-LGU electronic Business Permit and Licensing System (eBPLS) for the Philippines, piloting with San Miguel, Bulacan.

See [`CLAUDE.md`](./CLAUDE.md) for the full build specification — non-negotiable rules, schema, RLS, workflow state machine, and build order. Read that before touching anything in here.

## Status

Scaffolded, not yet wired to any live services.

- [x] Next.js (App Router, TypeScript, Tailwind) scaffold
- [x] Database schema drafted — [`supabase/migrations/0001_initial_schema.sql`](./supabase/migrations/0001_initial_schema.sql)
- [x] RLS policies drafted — [`supabase/migrations/0002_rls_policies.sql`](./supabase/migrations/0002_rls_policies.sql)
- [x] `reference/` populated — fee computation source, HTML prototypes, legacy business data, and the unreconciled fee guide (see `reference/README.md` for what's in there and why)
- [x] Supabase project created and migrations run (schema + RLS both verified live)
- [x] GitHub repo created and pushed — [infomuniserve-creator/muniserve-](https://github.com/infomuniserve-creator/muniserve-)
- [x] Vercel project connected, deployed, env vars set
- [x] Seed script written — `supabase/seed/seed_san_miguel_fee_rules.sql` (+ migration `0003_fee_rule_bracket_rate_basis.sql`). Not yet run against the live DB — see CLAUDE.md section 7a for discrepancies resolved while writing it.
- [ ] Bulk-import legacy business roster into `businesses`
- [ ] Staff auth + dashboards
- [ ] Applicant OTP flow
- [ ] Review workflow wiring
- [ ] Fee computation engine
- [ ] Payments, permits, notifications

## What needs to happen before development continues

1. **Create the Supabase project** (supabase.com), then run the two migrations in `supabase/migrations/` in order via the SQL editor or `supabase db push`.
2. **Create a GitHub repo** and push this folder to it.
3. **Create a Vercel project** connected to that repo for auto-deploy on push.
4. **Env vars** — done for Supabase + Resend, both locally in `.env.local` and in Vercel. Still missing: `SEMAPHORE_API_KEY` (needed for step 5, applicant OTP flow — not urgent yet).

None of the above requires a code change — this is account creation and configuration, not something to script.
