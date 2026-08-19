-- Purely informational note captured by the self-service business import
-- (2026-08-19 follow-up) -- "was this business's most recent/founding
-- filing new or renewal," for reference only in the Business Registry.
-- Deliberately not the same concept as applications.application_type,
-- which is a real, per-application fact -- a business itself isn't new
-- or renewal, only a specific application is, and a business can have
-- both new and renewal applications across different years. No workflow
-- logic reads this column; it's display-only, matching the existing
-- legacy_license_no/legacy_owner_name "note from the import" convention.
alter table businesses add column legacy_application_type text;
