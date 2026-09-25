-- lifecycle-messaging module tests, run by pnpm db:dry-run (packages/db/README.md; global view and
-- Data API checks run once for every module in tests/core.test.sql).
begin;
set local client_min_messages = warning;

-- programme_runs is pipeline-only: nabvy_app holds nothing on the schema at all (README.md,
-- "Decisions": no user-facing feature reads "messages sent to me" yet) ------------------------
do $$
begin
  if has_schema_privilege('nabvy_app', 'lifecycle_messaging', 'usage') then
    raise exception 'nabvy_app can use the lifecycle_messaging schema';
  end if;
end;
$$;

do $$
begin
  if has_table_privilege('nabvy_app', 'lifecycle_messaging.programme_runs', 'select')
     or has_table_privilege('nabvy_app', 'lifecycle_messaging.programme_runs', 'insert') then
    raise exception 'nabvy_app holds a privilege on programme_runs';
  end if;
end;
$$;

-- nabvy_pipeline: select and insert (the trigger-event scan and the send it records), and delete
-- (the account.deleted purge handler), but never update: a run, once recorded, is never changed -
set local role nabvy_pipeline;
insert into lifecycle_messaging.programme_runs (user_id, programme, step, triggered_at, at)
values ('00000000-0000-4000-8000-0000000000a1', 'channel-not-linked', '2h', now(), now());
reset role;

do $$
declare
  seen integer;
begin
  set local role nabvy_pipeline;
  select count(*) into seen from lifecycle_messaging.programme_runs
    where user_id = '00000000-0000-4000-8000-0000000000a1';
  if seen <> 1 then raise exception 'nabvy_pipeline could not read the row it inserted'; end if;
  reset role;
end;
$$;

do $$
begin
  set local role nabvy_pipeline;
  begin
    update lifecycle_messaging.programme_runs set at = now() where programme = 'channel-not-linked';
    raise exception 'nabvy_pipeline updated a programme_runs row';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

do $$
begin
  set local role nabvy_pipeline;
  delete from lifecycle_messaging.programme_runs
    where user_id = '00000000-0000-4000-8000-0000000000a1';
  reset role;
end;
$$;

-- A repeat insert for the same (user_id, programme, step, triggered_at) is the idempotency guard
-- (rule 8): the primary key refuses the duplicate, `insertRun`'s onConflictDoNothing relies on it -
do $$
declare
  ts timestamptz := '2026-09-24T12:00:00.000Z';
begin
  set local role nabvy_pipeline;
  insert into lifecycle_messaging.programme_runs (user_id, programme, step, triggered_at, at)
  values ('00000000-0000-4000-8000-0000000000a2', 'trial', 'day1', ts, ts);
  begin
    insert into lifecycle_messaging.programme_runs (user_id, programme, step, triggered_at, at)
    values ('00000000-0000-4000-8000-0000000000a2', 'trial', 'day1', ts, ts);
    raise exception 'a duplicate (user_id, programme, step, triggered_at) was accepted';
  exception when unique_violation then null;
  end;
  delete from lifecycle_messaging.programme_runs where user_id = '00000000-0000-4000-8000-0000000000a2';
  reset role;
end;
$$;

-- Check constraint: only the seven built programmes (src/domain/programmes.ts) are accepted -----
do $$
begin
  set local role nabvy_pipeline;
  begin
    insert into lifecycle_messaging.programme_runs (user_id, programme, step, triggered_at, at)
    values ('00000000-0000-4000-8000-0000000000a3', 'abandoned-checkout', '1h', now(), now());
    raise exception 'an unbuilt programme name was accepted';
  exception when check_violation then null;
  end;
  reset role;
end;
$$;

-- v_runs: column allowlist and the switches filter ---------------------------------------------
do $$
declare
  cols text;
begin
  select string_agg(column_name, ',' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'lifecycle_messaging' and table_name = 'v_runs';
  if cols <> 'user_id,programme,step,triggered_at,at' then
    raise exception 'v_runs column list changed: %', cols;
  end if;
end;
$$;

set local role nabvy_pipeline;
insert into lifecycle_messaging.programme_runs (user_id, programme, step, triggered_at, at)
values ('00000000-0000-4000-8000-0000000000b1', 'channel-not-linked', '2h', now(), now());
reset role;

-- No row in switches.switches for 'lifecycle-messaging' yet: switches.state() reads 'off' for an
-- unknown name, so the view must hide every row even though b1's row exists in the table.
do $$
declare
  seen integer;
begin
  select count(*) into seen from lifecycle_messaging.v_runs;
  if seen <> 0 then raise exception 'v_runs shows rows while the switch is off (unset)'; end if;
end;
$$;

insert into switches.switches (name, kind, state) values ('lifecycle-messaging', 'module', 'shadow');

do $$
declare
  seen integer;
begin
  select count(*) into seen from lifecycle_messaging.v_runs
  where user_id = '00000000-0000-4000-8000-0000000000b1';
  if seen <> 1 then raise exception 'v_runs hides a row while the switch is shadow'; end if;
end;
$$;

update switches.switches set state = 'off' where name = 'lifecycle-messaging';

do $$
declare
  seen integer;
begin
  select count(*) into seen from lifecycle_messaging.v_runs;
  if seen <> 0 then raise exception 'v_runs shows rows once the switch is off again'; end if;
end;
$$;

update switches.switches set state = 'on' where name = 'lifecycle-messaging';

-- Grants: exactly nabvy_pipeline reads v_runs (rule 5 of _rules.md: internal view), and no role
-- outside nabvy_pipeline holds anything on the schema ------------------------------------------
do $$
declare
  readers text;
  role_name text;
  leak text;
begin
  select string_agg(grantee, ',' order by grantee) into readers
  from information_schema.role_table_grants
  where table_schema = 'lifecycle_messaging' and table_name = 'v_runs' and privilege_type = 'SELECT'
    and grantee <> 'postgres';
  if readers <> 'nabvy_pipeline' then
    raise exception 'lifecycle_messaging.v_runs readers changed: %', readers;
  end if;

  foreach role_name in array array['anon', 'authenticated', 'nabvy_app'] loop
    select string_agg(c.relname, ', ') into leak
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'lifecycle_messaging' and c.relkind in ('r', 'v', 'm')
      and (has_table_privilege(role_name, c.oid, 'select')
           or has_table_privilege(role_name, c.oid, 'insert')
           or has_table_privilege(role_name, c.oid, 'update')
           or has_table_privilege(role_name, c.oid, 'delete'));
    if leak is not null then raise exception 'FAILED: % holds privileges on %', role_name, leak; end if;
    if role_name in ('anon', 'authenticated')
       and has_schema_privilege(role_name, 'lifecycle_messaging', 'usage') then
      raise exception 'FAILED: % can use the lifecycle_messaging schema', role_name;
    end if;
  end loop;
end;
$$;

select 'lifecycle-messaging module tests passed';
rollback;
