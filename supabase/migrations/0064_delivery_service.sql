-- Delivery Service (2026-08-22, project owner's own idea, discussed and
-- confirmed before building): an applicant whose permit is ready for
-- release ("pending_release") can ask to have it delivered instead of
-- picking it up in person. Off by default -- an LGU has to deliberately
-- turn this on and provide a real courier contact before it ever shows
-- up anywhere, same "no generic fallback for a real-world specific fact"
-- reasoning as mayor_name/treasurer_name/sender_name.
alter table lgus add column delivery_service_enabled boolean not null default false;
alter table lgus add column courier_name text;
alter table lgus add column courier_phone text;

-- Set the moment the applicant clicks "Request delivery" on their status
-- page. Null = default assumption (they'll pick it up themselves) --
-- deliberately not a separate enum/boolean, since "requested at time X"
-- is also what BPLO needs to see on the release queue, and there's
-- nothing to model beyond "has this happened yet."
alter table applications add column delivery_requested_at timestamptz;
