-- want-manager: grants, RLS isolation, the two SECURITY DEFINER functions, the switch filter and
-- the views. Rolled back.
begin;
set local client_min_messages = warning;

do $$
declare
  r text;
  v text;
begin
  -- The web app writes its own rows entirely inside withUser (and may delete a want); the
  -- pipeline only reads (for the internal views and wantOwners) and deletes (the purge).
  foreach v in array array['wants', 'criteria', 'preferences'] loop
    if not (has_table_privilege('nabvy_app', 'want_manager.' || v, 'select')
            and has_table_privilege('nabvy_app', 'want_manager.' || v, 'insert')
            and has_table_privilege('nabvy_app', 'want_manager.' || v, 'update')
            and has_table_privilege('nabvy_app', 'want_manager.' || v, 'delete')) then
      raise exception 'nabvy_app lacks its % grants', v;
    end if;
    if not (has_table_privilege('nabvy_pipeline', 'want_manager.' || v, 'select')
            and has_table_privilege('nabvy_pipeline', 'want_manager.' || v, 'delete')) then
      raise exception 'nabvy_pipeline lacks its % purge grants', v;
    end if;
    if has_table_privilege('nabvy_pipeline', 'want_manager.' || v, 'insert')
       or has_table_privilege('nabvy_pipeline', 'want_manager.' || v, 'update') then
      raise exception 'nabvy_pipeline can write % (writes must go through withUser)', v;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'want_manager' and tablename = v
                   and policyname = 'user_isolation') then
      raise exception '% has no user_isolation policy', v;
    end if;
  end loop;

  -- Views: the four internal ones to the pipeline only, the user-facing one to the web app only.
  foreach v in array array['v_wants', 'v_want_terms_by_centre', 'v_want_parts', 'v_want_areas'] loop
    if not has_table_privilege('nabvy_pipeline', 'want_manager.' || v, 'select')
       or has_table_privilege('nabvy_app', 'want_manager.' || v, 'select') then
      raise exception '% grants are wrong', v;
    end if;
    if exists (select 1 from information_schema.columns
               where table_schema = 'want_manager' and table_name = v and column_name like '%user%') then
      raise exception '% carries a user column', v;
    end if;
  end loop;
  if not has_table_privilege('nabvy_app', 'want_manager.v_want_manager_wants', 'select')
     or has_table_privilege('nabvy_pipeline', 'want_manager.v_want_manager_wants', 'select') then
    raise exception 'v_want_manager_wants grants are wrong';
  end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
      where table_schema = 'want_manager' and table_name = 'v_want_manager_wants')
     is distinct from array['id', 'centre_id', 'centre_verified', 'radius_km', 'price_cap_minor',
       'currency', 'active', 'cadence_seconds', 'delivery_speed', 'delivery_methods', 'alternatives',
       'pc_containment', 'alternatives_max_price_minor', 'instant_alternatives', 'instant_top_picks',
       'filter', 'criteria', 'created_at', 'updated_at'] then
    raise exception 'v_want_manager_wants has other columns than the allowed list';
  end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
      where table_schema = 'want_manager' and table_name = 'v_want_areas')
     is distinct from array['centre_id', 'lat', 'lng', 'radius_km', 'accepts_delivery'] then
    raise exception 'v_want_areas has other columns than the allowed list';
  end if;

  -- Functions: SECURITY DEFINER, pinned search_path, executable by nabvy_app only.
  foreach v in array array['nearest_centre', 'fair_use_want_cap'] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'want_manager' and p.proname = v and p.prosecdef
                     and p.provolatile = 's'
                     and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then
      raise exception 'want_manager.% is not a stable security definer with a pinned search_path', v;
    end if;
  end loop;
  if not has_function_privilege('nabvy_app', 'want_manager.nearest_centre(double precision, double precision)', 'execute')
     or has_function_privilege('nabvy_pipeline', 'want_manager.nearest_centre(double precision, double precision)', 'execute')
     or has_function_privilege('anon', 'want_manager.nearest_centre(double precision, double precision)', 'execute') then
    raise exception 'nearest_centre grants are wrong';
  end if;
  if not has_function_privilege('nabvy_app', 'want_manager.fair_use_want_cap()', 'execute')
     or has_function_privilege('nabvy_pipeline', 'want_manager.fair_use_want_cap()', 'execute') then
    raise exception 'fair_use_want_cap grants are wrong';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_schema_privilege(r, 'want_manager', 'usage') then
      raise exception '% can use schema want_manager', r;
    end if;
  end loop;
  if exists (select 1 from nabvy_core.view_violations() where view_name like 'want_manager.%') then
    raise exception 'a want_manager view breaks the view rules';
  end if;
end;
$$;

-- Constraints: vocabularies, ranges and the criterion shape.
do $$
declare
  refused boolean;
  probe text;
begin
  foreach probe in array array[
    $q$insert into want_manager.wants (user_id, lat, lng, radius_km, currency, cadence_seconds, delivery_methods, version_hash) values ('00000000-0000-4000-8000-0000000000b1', 50, 0, 0, 'GBP', 300, '{collection}', repeat('0', 64))$q$,
    $q$insert into want_manager.wants (user_id, lat, lng, radius_km, currency, cadence_seconds, delivery_methods, version_hash) values ('00000000-0000-4000-8000-0000000000b1', 50, 0, 10, 'USD', 300, '{collection}', repeat('0', 64))$q$,
    $q$insert into want_manager.wants (user_id, lat, lng, radius_km, currency, cadence_seconds, delivery_methods, version_hash) values ('00000000-0000-4000-8000-0000000000b1', 50, 0, 10, 'GBP', 120, '{collection}', repeat('0', 64))$q$,
    $q$insert into want_manager.wants (user_id, lat, lng, radius_km, currency, cadence_seconds, delivery_methods, version_hash) values ('00000000-0000-4000-8000-0000000000b1', 50, 0, 10, 'GBP', 300, '{courier}', repeat('0', 64))$q$,
    $q$insert into want_manager.wants (user_id, lat, lng, radius_km, currency, cadence_seconds, delivery_methods, delivery_speed, version_hash) values ('00000000-0000-4000-8000-0000000000b1', 50, 0, 10, 'GBP', 300, '{collection}', 'hourly', repeat('0', 64))$q$,
    $q$insert into want_manager.wants (user_id, lat, lng, radius_km, currency, cadence_seconds, delivery_methods, price_cap_minor, version_hash) values ('00000000-0000-4000-8000-0000000000b1', 50, 0, 10, 'GBP', 300, '{collection}', 0, repeat('0', 64))$q$,
    $q$insert into want_manager.preferences (user_id, channels) values ('00000000-0000-4000-8000-0000000000b1', '{sms}')$q$
  ] loop
    refused := false;
    begin
      execute probe;
    exception when check_violation then
      refused := true;
    end;
    if not refused then
      raise exception 'constraint did not refuse: %', probe;
    end if;
  end loop;
end;
$$;

-- Seed: two users, a centre, a paid entitlement for one user, a fair-use limit for the other.
insert into switches.switches (name, kind, state) values
  ('want-manager', 'module', 'on'), ('city-pages', 'module', 'on'), ('subscriptions', 'module', 'on'),
  ('product-catalogue', 'module', 'on')
  on conflict (name) do update set state = 'on';
insert into city_pages.city_pages (city_page_id, name, lat, lng, coord_source, first_seen_at)
  values ('db-test-chichester', 'Chichester', 50.8367, -0.7792, 'seed', now());
insert into city_pages.centres (city_page_id, active, verified, country, currency, area_km)
  values ('db-test-chichester', true, false, 'GB', 'GBP', 100);
insert into subscriptions.entitlements (user_id, tier, status, areas, wants, channels, last_event_id, last_event_at)
  values ('00000000-0000-4000-8000-0000000000b1', 'pro', 'active', 1, 5, '{telegram}', 'evt_db_test', now());
insert into account.standing (user_id, status, limits)
  values ('00000000-0000-4000-8000-0000000000b2', 'active', '{"maxActiveHunts": 1}');
insert into want_manager.wants (id, user_id, lat, lng, radius_km, centre_id, currency, cadence_seconds, delivery_methods, version_hash) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 50.84, -0.78, 25, 'db-test-chichester', 'GBP', 300, '{collection}', repeat('1', 64)),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b2', 50.86, -0.77, 10, 'db-test-chichester', 'GBP', 900, '{collection,posted}', repeat('2', 64));
insert into want_manager.criteria (want_id, user_id, position, part_type, family) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 0, 'gpu', 'RTX 40'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b2', 0, 'gpu', 'RTX 40');

-- RLS: a user sees, updates, deletes and inserts only their own rows, through withUser.
set local role nabvy_app;
set local app.user_id = '00000000-0000-4000-8000-0000000000b1';
do $$
begin
  if (select count(*) from want_manager.v_want_manager_wants) <> 1 then
    raise exception 'v_want_manager_wants does not show exactly the user''s own row';
  end if;
  if exists (select 1 from want_manager.wants where id = '00000000-0000-4000-8000-0000000000c2')
     or exists (select 1 from want_manager.criteria where want_id = '00000000-0000-4000-8000-0000000000c2') then
    raise exception 'nabvy_app can see another user''s want';
  end if;
  update want_manager.wants set radius_km = 99 where id = '00000000-0000-4000-8000-0000000000c2';
  if found then
    raise exception 'nabvy_app updated another user''s want';
  end if;
  delete from want_manager.wants where id = '00000000-0000-4000-8000-0000000000c2';
  if found then
    raise exception 'nabvy_app deleted another user''s want';
  end if;
  -- The SECURITY DEFINER functions, called as nabvy_app: a centre for a point; no fair-use cap
  -- for this user, one for the other.
  if (select centre_id from want_manager.nearest_centre(50.9, -0.7)) <> 'db-test-chichester' then
    raise exception 'nearest_centre did not find the seeded centre';
  end if;
  if exists (select 1 from want_manager.fair_use_want_cap()) then
    raise exception 'fair_use_want_cap returned a cap for a user without one';
  end if;
end;
$$;
do $$
declare
  refused boolean;
begin
  refused := false;
  begin
    insert into want_manager.wants (user_id, lat, lng, radius_km, currency, cadence_seconds, delivery_methods, version_hash)
      values ('00000000-0000-4000-8000-0000000000b2', 50, 0, 10, 'GBP', 300, '{collection}', repeat('3', 64));
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then
    raise exception 'nabvy_app inserted a want for another user';
  end if;
  refused := false;
  begin
    insert into want_manager.criteria (want_id, user_id, position, part_type, family)
      values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b2', 1, 'gpu', 'RTX 30');
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then
    raise exception 'nabvy_app inserted a criterion for another user';
  end if;
end;
$$;
set local app.user_id = '00000000-0000-4000-8000-0000000000b2';
do $$
begin
  if (select max_active_hunts from want_manager.fair_use_want_cap()) <> 1 then
    raise exception 'fair_use_want_cap did not return the user''s limit';
  end if;
end;
$$;
reset role;
set local app.user_id = '';
set local role nabvy_app;
do $$
begin
  if exists (select 1 from want_manager.fair_use_want_cap()) then
    raise exception 'fair_use_want_cap returned a row outside withUser';
  end if;
  if exists (select 1 from want_manager.wants) then
    raise exception 'nabvy_app sees wants outside withUser';
  end if;
end;
$$;
reset role;

-- The internal views, as the pipeline: counts, the paid flag, the rounded point; no user column.
set local role nabvy_pipeline;
do $$
declare
  t record;
  a record;
begin
  select * into t from want_manager.v_want_terms_by_centre where centre_id = 'db-test-chichester';
  if t.family <> 'RTX 40' or t.want_count <> 2 or t.paid_want_count <> 1 then
    raise exception 'v_want_terms_by_centre is wrong: %', t;
  end if;
  if (select count(*) from want_manager.v_wants where paid) <> 1 then
    raise exception 'v_wants paid flag is wrong';
  end if;
  if (select count(*) from want_manager.v_want_parts) <> 1 then
    raise exception 'v_want_parts should have one distinct part';
  end if;
  select * into a from want_manager.v_want_areas where radius_km = 10;
  if a.lat <> 50.85 or a.lng <> -0.75 or not a.accepts_delivery then
    raise exception 'v_want_areas is wrong: %', a;
  end if;
  if (select criteria from want_manager.v_wants where id = '00000000-0000-4000-8000-0000000000c1')
     <> '[{"family": "RTX 40", "minAttr": null, "partType": "gpu", "orBetter": false, "catalogueId": null}]'::jsonb then
    raise exception 'v_wants criteria JSON is wrong';
  end if;
end;
$$;
reset role;

-- The switch filter (rule 11): shadow hides the user-facing view; off empties every view.
update switches.switches set state = 'shadow' where name = 'want-manager';
set local role nabvy_app;
set local app.user_id = '00000000-0000-4000-8000-0000000000b1';
do $$
begin
  if exists (select 1 from want_manager.v_want_manager_wants) then
    raise exception 'v_want_manager_wants shows rows while the module is in shadow';
  end if;
end;
$$;
reset role;
set local role nabvy_pipeline;
do $$
begin
  if not exists (select 1 from want_manager.v_wants) then
    raise exception 'v_wants is empty in shadow, where it should still have rows';
  end if;
end;
$$;
reset role;
update switches.switches set state = 'off' where name = 'want-manager';
set local role nabvy_pipeline;
do $$
begin
  if exists (select 1 from want_manager.v_wants) or exists (select 1 from want_manager.v_want_terms_by_centre)
     or exists (select 1 from want_manager.v_want_parts) or exists (select 1 from want_manager.v_want_areas) then
    raise exception 'an internal view shows rows while the module is off';
  end if;
end;
$$;
reset role;

-- The purge path: the pipeline deletes a user's rows (criteria cascade).
set local role nabvy_pipeline;
delete from want_manager.wants where user_id = '00000000-0000-4000-8000-0000000000b1';
do $$
begin
  if exists (select 1 from want_manager.criteria where user_id = '00000000-0000-4000-8000-0000000000b1') then
    raise exception 'criteria did not cascade on purge';
  end if;
end;
$$;
reset role;

rollback;
