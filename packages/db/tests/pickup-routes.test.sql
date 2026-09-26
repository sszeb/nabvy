-- pickup-routes: grants, RLS isolation between users, no view over the schema, no plaintext
-- address column, and the sealed columns kept from the pipeline. Rolled back.
begin;
set local client_min_messages = warning;

do $$
declare
  r text;
  t text;
begin
  -- No Data API role reaches the schema.
  foreach r in array array['anon', 'authenticated'] loop
    if has_schema_privilege(r, 'pickup_routes', 'usage') then
      raise exception '% can use schema pickup_routes', r;
    end if;
  end loop;

  -- No view of any kind over pickups, route_plans or the rest (card: "the db test finds no view
  -- over pickups or route_plans"; owner's decision docs/decisions.md:174).
  if exists (select 1 from pg_views where schemaname = 'pickup_routes')
     or exists (select 1 from pg_matviews where schemaname = 'pickup_routes') then
    raise exception 'pickup_routes has a view; the owner decided it has none';
  end if;
  if exists (select 1 from nabvy_core.view_violations() where view_name like 'pickup_routes.%') then
    raise exception 'pickup_routes views break the view conventions';
  end if;

  -- No plain address, postcode, note or coordinate column anywhere in the schema.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'pickup_routes'
      and column_name ~ '(^|_)(address|postcode|notes?|lat|lng|lon|point|geom)(_|$)'
      and column_name not in ('has_point')
  ) then
    raise exception 'pickup_routes has a plaintext address, note or coordinate column';
  end if;

  -- Every table: RLS on, the web app has full CRUD inside withUser, the pipeline may delete
  -- (purge) but never insert, and never reads a sealed column.
  foreach t in array array['pickups', 'pickup_reminders', 'pickup_days', 'route_plans', 'planner_defaults'] loop
    if not (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'pickup_routes' and c.relname = t) then
      raise exception 'pickup_routes.% has no row-level security', t;
    end if;
    if not (has_table_privilege('nabvy_app', 'pickup_routes.' || t, 'select')
            and has_table_privilege('nabvy_app', 'pickup_routes.' || t, 'insert')
            and has_table_privilege('nabvy_app', 'pickup_routes.' || t, 'update')
            and has_table_privilege('nabvy_app', 'pickup_routes.' || t, 'delete')) then
      raise exception 'nabvy_app lacks its grants on pickup_routes.%', t;
    end if;
    if has_table_privilege('nabvy_pipeline', 'pickup_routes.' || t, 'insert') then
      raise exception 'nabvy_pipeline can insert into pickup_routes.% (writes must go through withUser)', t;
    end if;
    if not has_table_privilege('nabvy_pipeline', 'pickup_routes.' || t, 'delete') then
      raise exception 'nabvy_pipeline cannot purge pickup_routes.%', t;
    end if;
    if t in ('pickups', 'pickup_days', 'planner_defaults')
       and has_column_privilege('nabvy_pipeline', 'pickup_routes.' || t, 'private_enc', 'select') then
      raise exception 'nabvy_pipeline can read the sealed column of pickup_routes.%', t;
    end if;
  end loop;
  if has_table_privilege('nabvy_pipeline', 'pickup_routes.pickups', 'update') then
    raise exception 'nabvy_pipeline can update pickups';
  end if;
  if not has_column_privilege('nabvy_pipeline', 'pickup_routes.pickup_reminders', 'sent_at', 'update') then
    raise exception 'nabvy_pipeline cannot mark a reminder sent';
  end if;
  if has_column_privilege('nabvy_pipeline', 'pickup_routes.pickup_reminders', 'due_at', 'update') then
    raise exception 'nabvy_pipeline can move a reminder';
  end if;
end;
$$;

-- Constraints refuse values outside the contracts.
do $$
declare
  refused boolean;
  probe text;
begin
  foreach probe in array array[
    $q$insert into pickup_routes.pickups (user_id, label, private_enc, day, window_kind, status) values ('00000000-0000-4000-8000-0000000000b1', 'x', '\x00'::bytea, '2026-09-26', 'sometime', 'arranged')$q$,
    $q$insert into pickup_routes.pickups (user_id, label, private_enc, day, window_kind, status) values ('00000000-0000-4000-8000-0000000000b1', 'x', '\x00'::bytea, '2026-09-26', 'at', 'done')$q$,
    $q$insert into pickup_routes.pickups (user_id, label, private_enc, day, window_kind, service_minutes) values ('00000000-0000-4000-8000-0000000000b1', 'x', '\x00'::bytea, '2026-09-26', 'at', 0)$q$,
    $q$insert into pickup_routes.pickups (user_id, label, private_enc, day, window_kind, price_minor) values ('00000000-0000-4000-8000-0000000000b1', 'x', '\x00'::bytea, '2026-09-26', 'at', -1)$q$,
    $q$insert into pickup_routes.pickup_days (user_id, day, start_kind, start_time, latest_finish) values ('00000000-0000-4000-8000-0000000000b1', '2026-09-26', 'work', '09:00', '18:00')$q$,
    $q$insert into pickup_routes.planner_defaults (user_id, service_minutes) values ('00000000-0000-4000-8000-0000000000b1', 500)$q$
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

-- RLS: a user sees, updates, deletes and inserts only their own rows, through withUser.
insert into pickup_routes.pickups (id, user_id, label, private_enc, day, window_kind, window_start) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 'RTX 3090 – Bognor', '\x01'::bytea, '2026-09-26', 'at', '10:30'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b2', 'Monitor', '\x01'::bytea, '2026-09-26', 'unagreed', null);
insert into pickup_routes.pickup_days (id, user_id, day, start_time, latest_finish) values
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000b2', '2026-09-26', '09:00', '18:00');
insert into pickup_routes.route_plans (user_id, day_id, version, mode, basis, start_at, finish_at, drive_seconds, distance_metres, stops, unassigned) values
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000d2', 1, 'optimised', 'estimate', now(), now(), 0, 0, '[]', '[]');
insert into pickup_routes.planner_defaults (user_id) values ('00000000-0000-4000-8000-0000000000b2');

set local role nabvy_app;
set local app.user_id = '00000000-0000-4000-8000-0000000000b1';
do $$
begin
  if (select count(*) from pickup_routes.pickups) <> 1 then
    raise exception 'nabvy_app sees other users'' pickups';
  end if;
  if exists (select 1 from pickup_routes.pickup_days)
     or exists (select 1 from pickup_routes.route_plans)
     or exists (select 1 from pickup_routes.planner_defaults) then
    raise exception 'nabvy_app sees another user''s day, plan or defaults';
  end if;
  update pickup_routes.pickups set label = 'mine now' where id = '00000000-0000-4000-8000-0000000000c2';
  if found then
    raise exception 'nabvy_app updated another user''s pickup';
  end if;
  delete from pickup_routes.pickups where id = '00000000-0000-4000-8000-0000000000c2';
  if found then
    raise exception 'nabvy_app deleted another user''s pickup';
  end if;
end;
$$;
do $$
declare
  refused boolean;
begin
  refused := false;
  begin
    insert into pickup_routes.pickups (user_id, label, private_enc, day, window_kind)
      values ('00000000-0000-4000-8000-0000000000b2', 'x', '\x01'::bytea, '2026-09-26', 'unagreed');
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then
    raise exception 'nabvy_app inserted a pickup for another user';
  end if;
  refused := false;
  begin
    insert into pickup_routes.planner_defaults (user_id) values ('00000000-0000-4000-8000-0000000000b3');
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then
    raise exception 'nabvy_app inserted defaults for another user';
  end if;
end;
$$;
reset role;

-- Outside withUser (no app.user_id) the web app sees nothing at all.
select set_config('app.user_id', '', true);
set local role nabvy_app;
do $$
begin
  if exists (select 1 from pickup_routes.pickups) then
    raise exception 'nabvy_app sees pickups outside withUser';
  end if;
end;
$$;
reset role;

-- The pipeline can purge a user (account.deleted) but cannot read a sealed blob.
set local role nabvy_pipeline;
do $$
declare
  refused boolean := false;
begin
  begin
    perform private_enc from pickup_routes.pickups limit 1;
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then
    raise exception 'nabvy_pipeline read a sealed pickup blob';
  end if;
  delete from pickup_routes.pickups where user_id = '00000000-0000-4000-8000-0000000000b2';
  delete from pickup_routes.pickup_days where user_id = '00000000-0000-4000-8000-0000000000b2';
  delete from pickup_routes.planner_defaults where user_id = '00000000-0000-4000-8000-0000000000b2';
end;
$$;
reset role;
do $$
begin
  if exists (select 1 from pickup_routes.pickups where user_id = '00000000-0000-4000-8000-0000000000b2')
     or exists (select 1 from pickup_routes.route_plans where user_id = '00000000-0000-4000-8000-0000000000b2') then
    raise exception 'the purge left rows behind (route_plans must cascade from pickup_days)';
  end if;
end;
$$;

rollback;
