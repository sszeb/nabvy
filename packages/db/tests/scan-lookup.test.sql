-- scan-lookup (services/scan-lookup): grants, per-user RLS on lookups, and the switch filter on
-- both v_results and app.v_scan_lookup_results. Rolled back.
begin;
set local client_min_messages = warning;

-- No Data API role reaches the schema, and this module's views follow the view conventions
-- (packages/db/README.md, "Views").
do $$
begin
  if has_schema_privilege('anon', 'scan_lookup', 'usage')
     or has_schema_privilege('authenticated', 'scan_lookup', 'usage') then
    raise exception 'scan_lookup is reachable by a Data API role';
  end if;
  if has_table_privilege('nabvy_app', 'scan_lookup.lookups', 'insert')
     or has_table_privilege('nabvy_app', 'scan_lookup.lookups', 'update')
     or has_table_privilege('nabvy_app', 'scan_lookup.lookups', 'delete') then
    raise exception 'nabvy_app can write scan_lookup.lookups';
  end if;
  if not has_table_privilege('nabvy_pipeline', 'scan_lookup.lookups', 'insert') then
    raise exception 'nabvy_pipeline cannot write scan_lookup.lookups';
  end if;
  if exists (select 1 from nabvy_core.view_violations() where view_name like 'scan_lookup.%') then
    raise exception 'scan_lookup views break the view conventions';
  end if;
end;
$$;

-- The module is on, so both views show rows.
set local role postgres;
insert into switches.switches (name, kind, state) values ('scan-lookup', 'module', 'on')
  on conflict (name) do update set state = excluded.state;
reset role;

-- Two users' scans, written as the pipeline (lookup() runs inside withPipeline).
set local role nabvy_pipeline;
insert into scan_lookup.lookups (scan_id, user_id, catalogue_id, status, sources, bands, cost, latency_ms, at) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000d1', 'gpu:rtx3090', 'priced',
   array['facebook'], '[{"source":"facebook","context":"standalone","condition":"used_good","label":"RTX 3090","n":12,"median":25000,"rangeLow":23000,"rangeHigh":27000,"currency":"GBP"}]'::jsonb,
   1, 5, now()),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000d2', 'gpu:rtx3090', 'not_enough_asks',
   array['facebook'], '[]'::jsonb, 1, 4, now());
reset role;

do $$
begin
  if (select count(*) from scan_lookup.v_results) <> 2 then
    raise exception 'v_results does not show both pipeline rows';
  end if;
end;
$$;

-- nabvy_app as d1: sees only its own row through app.v_scan_lookup_results, and cannot write.
set local role nabvy_app;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000d1', true);
do $$
declare
  refused boolean := false;
begin
  if (select count(*) from app.v_scan_lookup_results) <> 1 then
    raise exception 'nabvy_app sees another user''s lookup, or none at all';
  end if;
  if (select scan_id from app.v_scan_lookup_results) <> '00000000-0000-4000-8000-0000000000c1' then
    raise exception 'nabvy_app sees the wrong row';
  end if;
  begin
    insert into scan_lookup.lookups (scan_id, user_id, catalogue_id, status, sources, bands, cost, latency_ms, at)
      values ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000d1',
              'gpu:rtx3090', 'priced', array['facebook'], '[]'::jsonb, 1, 1, now());
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then
    raise exception 'nabvy_app could write scan_lookup.lookups';
  end if;
end;
$$;
reset role;

-- Off: both views return no rows (rule 11), even though the table still holds them.
set local role postgres;
insert into switches.switches (name, kind, state) values ('scan-lookup', 'module', 'off')
  on conflict (name) do update set state = excluded.state;
reset role;
do $$
begin
  if exists (select 1 from scan_lookup.v_results) then
    raise exception 'v_results shows rows while scan-lookup is off';
  end if;
end;
$$;
set local role nabvy_app;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000d1', true);
do $$
begin
  if exists (select 1 from app.v_scan_lookup_results) then
    raise exception 'app.v_scan_lookup_results shows rows while scan-lookup is off';
  end if;
end;
$$;
reset role;

rollback;
