-- Storage for generated permit PDFs + QR code images (build order step 8,
-- part 2 -- see CLAUDE.md section 7k). Public, unlike application-documents
-- (migration 0007): once a permit is signed, the PDF and its QR code are
-- meant to be freely viewable/downloadable/shareable -- the applicant
-- downloads it from their status page, and the whole point of the QR code
-- is that anyone who scans it (an inspector, a curious customer) can load
-- the verification page without needing to be signed in as the applicant.
-- Uploads still only ever happen via service-role server code (mayor's
-- signPermit action) -- "public" here means public READ, not public write.

insert into storage.buckets (id, name, public)
values ('permit-pdfs', 'permit-pdfs', true)
on conflict (id) do nothing;
