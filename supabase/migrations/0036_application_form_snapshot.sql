-- Captures the full submitted-form field values at the moment an
-- application is filed (online or a BPLO-filed walk-in), independent of
-- the mutable `businesses` row those values are also written into.
--
-- Without this, "download the form as it was submitted" for an OLDER
-- application would silently read the business's CURRENT data -- which
-- may have since been overwritten by a later renewal -- instead of what
-- was actually typed for that specific application. This column is what
-- lets the downloadable submitted-form PDF (src/lib/application-form-pdf.ts)
-- stay permanently accurate to the application it belongs to.
--
-- Nullable: applications submitted before this column existed have no
-- snapshot. The PDF generator falls back to reconstructing from the
-- business's current data in that case, with a visible disclaimer.
--
-- No RLS policy needed -- RLS bounds rows on `applications`, not columns,
-- and every existing staff-scoped SELECT policy on this table already
-- covers reading this new column too.
alter table public.applications
  add column form_snapshot jsonb;

comment on column public.applications.form_snapshot is
  'Submitted-form field values as they were at submission time (FieldKey-shaped, see application-form-logic.ts). Null for applications submitted before 2026-08-16.';
