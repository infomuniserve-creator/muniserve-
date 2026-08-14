-- Closes a real observability gap caught while debugging the first live
-- staff-invite email failure (2026-08-14): notifications.ts's catch
-- blocks recorded status = 'failed' but never captured *why* -- not to
-- this column, not even to console.error. There was nothing to look at,
-- anywhere, to diagnose a failure. This column plus the accompanying
-- code fix (src/lib/notifications.ts) make every future failure
-- immediately queryable instead of a dead end.
alter table notifications_log add column error_detail text;
