-- travel-cost: grants, RLS isolation, the seeded rates and the switch-gated view. Rolled back.
begin;
set local client_min_messages = warning;

do $$
declare
  r text;
begin
  -- travel_rates: reference data, read by both roles directly (services/travel-cost's own
  -- tripCost()/params()); never written by an application role.
  if not (has_table_privilege('nabvy_app', 'travel_cost.travel_rates', 'select')
          and has_table_privilege('nabvy_pipeline', 'travel_cost.travel_rates', 'select')) then
    raise exception 'travel_rates is not readable by both roles';
  end if;
  if has_table_privilege('nabvy_app', 'travel_cost.travel_rates', 'insert')
     or has_table_privilege('nabvy_pipeline', 'travel_cost.travel_rates', 'insert') then
    raise exception 'travel_rates is writable by an application role';
  end if;
  -- user_travel_settings: the user manages their own row; the pipeline reads across users.
  if not (has_table_privilege('nabvy_app', 'travel_cost.user_travel_settings', 'select')
          and has_table_privilege('nabvy_app', 'travel_cost.user_travel_settings', 'insert')
          and has_table_privilege('nabvy_app', 'travel_cost.user_travel_settings', 'update')
          and has_table_privilege('nabvy_app', 'travel_cost.user_travel_settings', 'delete')
          and has_table_privilege('nabvy_pipeline', 'travel_cost.user_travel_settings', 'select')) then
    raise exception 'travel_cost.user_travel_settings grants are wrong';
  end if;
  if has_table_privilege('nabvy_pipeline', 'travel_cost.user_travel_settings', 'insert') then
    raise exception 'nabvy_pipeline can write user_travel_settings';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_schema_privilege(r, 'travel_cost', 'usage') then
      raise exception '% can use schema travel_cost', r;
    end if;
  end loop;
  if exists (select 1 from nabvy_core.view_violations() where view_name like 'travel_cost.%') then
    raise exception 'a travel_cost view breaks the view rules';
  end if;
end;
$$;

-- The rate table's constraints: a positive pence amount, and known kind/unit/fuel/tier values.
do $$
declare
  refused boolean;
  probe text;
begin
  foreach probe in array array[
    $q$insert into travel_cost.travel_rates (kind, pence_amount, unit, effective_from, source_url) values ('made-up-kind', 10, 'mile', '2026-01-01', 'https://example.com')$q$,
    $q$insert into travel_cost.travel_rates (kind, pence_amount, unit, effective_from, source_url) values ('advisory-fuel-rate', 0, 'mile', '2026-01-01', 'https://example.com')$q$,
    $q$insert into travel_cost.travel_rates (kind, pence_amount, unit, effective_from, source_url) values ('advisory-fuel-rate', 10, 'furlong', '2026-01-01', 'https://example.com')$q$
  ] loop
    refused := false;
    begin
      execute probe;
    exception when check_violation then
      refused := true;
    end;
    if not refused then
      raise exception 'not refused: %', probe;
    end if;
  end loop;
end;
$$;

-- RLS isolation: a user reads and writes only their own settings through nabvy_app.
insert into travel_cost.user_travel_settings (user_id, preset, fuel, engine_band) values
  ('00000000-0000-4000-8000-0000000000b1', 'fuel-only', 'petrol', '1401-2000'),
  ('00000000-0000-4000-8000-0000000000b2', 'hmrc-business', null, null);
set local role nabvy_app;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000b1', true);
do $$
begin
  if (select count(*) from travel_cost.user_travel_settings) <> 1 then
    raise exception 'nabvy_app sees another user''s settings';
  end if;
  update travel_cost.user_travel_settings set preset = 'custom'
    where user_id = '00000000-0000-4000-8000-0000000000b2';
  if found then
    raise exception 'nabvy_app updated another user''s settings';
  end if;
end;
$$;
reset role;

-- v_rates is gated by the module's own switch (rule 11: an internal view returns no rows off,
-- rows shadow or on) — travel_rates carries no exemption, unlike account's v_channels/v_standing.
do $$
begin
  if switches.state('travel-cost') <> 'off' then
    raise exception 'test assumption broken: travel-cost should have no switches row yet';
  end if;
end;
$$;
set local role nabvy_pipeline;
do $$
begin
  if (select count(*) from travel_cost.v_rates) <> 0 then
    raise exception 'v_rates returns rows while travel-cost is off';
  end if;
end;
$$;
reset role;
insert into switches.switches (name, kind, state) values ('travel-cost', 'module', 'on');
set local role nabvy_pipeline;
do $$
begin
  if (select count(*) from travel_cost.v_rates) = 0 then
    raise exception 'v_rates returns no rows while travel-cost is on';
  end if;
  if (select count(*) from travel_cost.v_rates where kind = 'advisory-fuel-rate') = 0 then
    raise exception 'the seeded advisory fuel rate is missing from v_rates';
  end if;
end;
$$;
reset role;

rollback;
