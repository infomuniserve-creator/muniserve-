-- Self-service permit print template (CLAUDE.md 7y) -- the actual
-- "BPLO uploads their own file" mechanism the original discussion asked
-- for, deferred out of section 7x's pass. Stores at most one active
-- template per LGU directly on lgus (same "one active configuration"
-- shape as automated_assessment_enabled), not a separate table -- a
-- template is inherently a singleton per LGU, same reasoning fee_rules'
-- own single-active-rate-set-per-category convention already follows.
--
-- print_template_path: the uploaded PDF's storage path (permit-print-
-- templates bucket, private -- see below). print_template_field_mapping:
-- jsonb, { "<PDF field name>": "<canonical data key>" }, built from
-- whatever field names actually exist in that specific upload -- there's
-- no fixed naming convention BPLO has to guess at, the mapping UI reads
-- the real field names back to them.

alter table lgus add column print_template_path text;
alter table lgus add column print_template_field_mapping jsonb;

-- Private, same posture as application-documents (migration 0007) --
-- this is an internal admin asset (a blank certificate template), not
-- something that needs public read the way permit-pdfs (migration 0014)
-- does. No storage.objects policies added -- uploads/reads go through
-- service-role server code only, same pattern application-documents
-- already established (the BPLO-role check happens in the calling
-- server action, not storage RLS).
insert into storage.buckets (id, name, public)
values ('permit-print-templates', 'permit-print-templates', false)
on conflict (id) do nothing;
