-- Configurable Permit No. / reference-number format per LGU (CLAUDE.md).
-- Prefix (field 1) reuses the existing lgus.short_code column -- it was
-- already exactly this, just not BPLO-editable or documented as such.
-- Fields 2/3 (year display width, counter zero-pad width) are new,
-- defaulted to match the current hardcoded behavior exactly (4-digit
-- year, 5-digit counter) so every existing LGU's number format is
-- byte-identical the moment this ships.
alter table lgus
  add column reference_year_digits integer not null default 4,
  add column reference_counter_digits integer not null default 5;

alter table lgus
  add constraint lgus_reference_year_digits_check check (reference_year_digits in (2, 4)),
  add constraint lgus_reference_counter_digits_check check (reference_counter_digits between 3 and 8);

-- application_reference_counters itself keeps counting by the REAL full
-- calendar year regardless of display width (see the function body
-- below) -- a 2-digit-display LGU must still reset its counter every
-- real year, not every 100 years.
create or replace function public.generate_application_reference(p_lgu_id uuid, p_year integer)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_short_code text;
  v_year_digits integer;
  v_counter_digits integer;
  v_year_part text;
  v_next integer;
begin
  select coalesce(short_code, 'APP'), coalesce(reference_year_digits, 4), coalesce(reference_counter_digits, 5)
    into v_short_code, v_year_digits, v_counter_digits
    from lgus where id = p_lgu_id;

  v_year_part := case v_year_digits
    when 2 then lpad((p_year % 100)::text, 2, '0')
    else lpad(p_year::text, 4, '0')
  end;

  insert into application_reference_counters (lgu_id, year, last_number)
  values (p_lgu_id, p_year, 1)
  on conflict (lgu_id, year)
    do update set last_number = application_reference_counters.last_number + 1
  returning last_number into v_next;

  return v_short_code || '-' || v_year_part || '-' || lpad(v_next::text, v_counter_digits, '0');
end;
$function$;
