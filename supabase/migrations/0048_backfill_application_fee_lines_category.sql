-- 6 pre-migration-0026 application_fee_lines rows (2 real applications,
-- MS-2026-00002/00003, from the very first days of the pilot) predate
-- fee_category/display_label being denormalized onto this table at write
-- time -- found while building the Stats & Reports revenue breakdown,
-- which groups by fee_category. All 6 resolve cleanly via their own
-- fee_rule_id (fee_rules.fee_category was itself already backfilled in
-- migration 0026), so fixed at the source rather than working around it
-- at query time -- benefits any future query, not just this one report.
update application_fee_lines afl
set fee_category = fr.fee_category,
    display_label = coalesce(afl.display_label, fr.name)
from fee_rules fr
where afl.fee_rule_id = fr.id
  and afl.fee_category is null;
