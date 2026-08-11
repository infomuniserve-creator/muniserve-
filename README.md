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
- [ ] Seed script for San Miguel's `fee_rules`
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
4. **Env vars** (once the above exist): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SEMAPHORE_API_KEY`, `RESEND_API_KEY` — put these in `.env.local` (already gitignored) and mirror them into Vercel's project settings.

None of the above requires a code change — this is account creation and configuration, not something to script.
