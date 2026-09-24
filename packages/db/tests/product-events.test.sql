-- product-events module tests, run by pnpm db:dry-run (packages/db/README.md; global view and
-- Data API checks run once for every module in tests/core.test.sql).
begin;
set local client_min_messages = warning;

-- nabvy_app can insert its own row inside withUser (app.user_id set), and only its own ----------
do $$
begin
  perform set_config('app.user_id', '00000000-0000-7000-8000-000000000001', true);
  set local role nabvy_app;
  insert into product_events.events (user_id, event, properties)
    values ('00000000-0000-7000-8000-000000000001', 'signup_completed', '{}'::jsonb);
  reset role;
end;
$$;

do $$
begin
  perform set_config('app.user_id', '00000000-0000-7000-8000-000000000001', true);
  set local role nabvy_app;
  begin
    insert into product_events.events (user_id, event, properties)
      values ('00000000-0000-7000-8000-000000000002', 'signup_completed', '{}'::jsonb);
    raise exception 'nabvy_app inserted an event for a different user';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

-- nabvy_app cannot read the table back at all (no select grant) --------------------------------
do $$
begin
  perform set_config('app.user_id', '00000000-0000-7000-8000-000000000001', true);
  set local role nabvy_app;
  begin
    perform 1 from product_events.events;
    raise exception 'nabvy_app selected from product_events.events';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

-- nabvy_pipeline can insert for any user, and read every row -----------------------------------
do $$
begin
  set local role nabvy_pipeline;
  insert into product_events.events (user_id, event, properties)
    values ('00000000-0000-7000-8000-000000000002', 'alert_delivered', '{}'::jsonb);
  reset role;
end;
$$;

do $$
declare
  seen integer;
begin
  set local role nabvy_pipeline;
  select count(*) into seen from product_events.events;
  if seen <> 2 then raise exception 'nabvy_pipeline saw % rows, expected 2', seen; end if;
  reset role;
end;
$$;

-- Append-only: no role may update, delete or truncate, not even the owner ----------------------
do $$
begin
  begin
    update product_events.events set event = 'x';
    raise exception 'an event row was updated';
  exception when insufficient_privilege then null;
  end;
end;
$$;

do $$
begin
  begin
    delete from product_events.events;
    raise exception 'an event row was deleted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

do $$
begin
  begin
    truncate product_events.events;
    raise exception 'product_events.events was truncated';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Partitioning: the initial window exists, and a write outside it still lands somewhere (the
-- default partition), never refused for lack of a partition -----------------------------------
do $$
declare
  seen integer;
begin
  select count(*) into seen from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'product_events' and c.relname = 'events_default';
  if seen <> 1 then raise exception 'events_default partition is missing'; end if;

  set local role nabvy_pipeline;
  insert into product_events.events (user_id, event, properties, at)
    values ('00000000-0000-7000-8000-000000000003', 'signup_completed', '{}'::jsonb, '2030-01-15T00:00:00Z');
  reset role;
end;
$$;

-- v_events: column allowlist, and the switches filter (rule 11 of _rules.md) --------------------
do $$
declare
  cols text;
  seen integer;
begin
  select string_agg(column_name, ',' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'product_events' and table_name = 'v_events';
  if cols <> 'id,user_id,event,properties,session_id,at' then
    raise exception 'v_events column list changed: %', cols;
  end if;

  -- No row in switches.switches for 'product-events' yet: switches.state() reads 'off' for an
  -- unknown name, so the view must hide every row even though they exist in the table.
  set local role nabvy_pipeline;
  select count(*) into seen from product_events.v_events;
  reset role;
  if seen <> 0 then raise exception 'v_events shows rows while the switch is off'; end if;
end;
$$;

insert into switches.switches (name, kind, state) values ('product-events', 'module', 'shadow');

do $$
declare
  seen integer;
begin
  set local role nabvy_pipeline;
  select count(*) into seen from product_events.v_events;
  reset role;
  if seen <> 3 then raise exception 'v_events hides rows while the switch is shadow, saw %', seen; end if;
end;
$$;

update switches.switches set state = 'off' where name = 'product-events';

do $$
declare
  seen integer;
begin
  set local role nabvy_pipeline;
  select count(*) into seen from product_events.v_events;
  reset role;
  if seen <> 0 then raise exception 'v_events shows rows once the switch is off again'; end if;
end;
$$;

-- Grants: exactly nabvy_pipeline reads v_events (rule 5 of _rules.md: internal view) ------------
do $$
declare
  readers text;
begin
  select string_agg(grantee, ',' order by grantee) into readers
  from information_schema.role_table_grants
  where table_schema = 'product_events' and table_name = 'v_events' and privilege_type = 'SELECT'
    and grantee <> 'postgres'; -- the view's owner, granted implicitly
  if readers <> 'nabvy_pipeline' then
    raise exception 'product_events.v_events readers changed: %', readers;
  end if;
end;
$$;

rollback;
