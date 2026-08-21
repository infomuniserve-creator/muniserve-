-- LGU logo for branded email notifications (2026-08-21, CLAUDE.md) --
-- public bucket, same reasoning as permit-pdfs (migration 0014): an email
-- client fetches the logo image directly from a plain URL with no auth,
-- so it can't be a signed/expiring link the way application-documents'
-- private bucket works. "Public" means public READ only -- uploads still
-- only ever happen via service-role server code (settings/logo-actions.ts),
-- gated on the BPLO role in the action itself, same posture as permit-pdfs
-- and permit-print-templates.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lgu-logos', 'lgu-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- lgus.logo_url (text, nullable) already existed in production before this
-- migration -- confirmed directly (both real LGUs have it, currently
-- null), not re-added here. Whatever earlier pass added it never wired up
-- a bucket or any reader/writer; this migration and the code that follows
-- it are what actually make the column mean something.
