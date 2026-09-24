-- route-health module tests, run by pnpm db:dry-run (packages/db/README.md; global view and Data
-- API checks run once for every module in tests/core.test.sql).
begin;
set local client_min_messages = warning;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'FAILED: %', what;
  end if;
end;
$$;

-- nabvy_app has no privilege at all: route-health holds no user rows and no user-facing view --
do $$
begin
  set local role nabvy_app;
  begin
    insert into route_health.route_state (region_id, state)
    values ('probe-app', '{"route":"graphql","runsSinceSwitch":0}');
    raise exception 'nabvy_app inserted into route_state';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

do $$
begin
  set local role nabvy_app;
  begin
    perform 1 from route_health.route_state;
    raise exception 'nabvy_app could read route_state';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

do $$
begin
  set local role nabvy_app;
  begin
    perform 1 from route_health.v_decisions;
    raise exception 'nabvy_app could read v_decisions';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

-- nabvy_pipeline: exactly the intended grants (select/insert/update on route_state,
-- select/insert/delete on route_runs — never delete a decision, never update a run) -----------
do $$
begin
  set local role nabvy_pipeline;
  begin
    delete from route_health.route_state where region_id = 'nope';
    raise exception 'nabvy_pipeline deleted from route_state';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

do $$
begin
  set local role nabvy_pipeline;
  begin
    update route_health.route_runs set at = now() where region_id = 'nope';
    raise exception 'nabvy_pipeline updated route_runs';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

set local role nabvy_pipeline;
insert into route_health.route_state (region_id, state)
values (
  'probe-region',
  '{"route":"graphql","runsSinceSwitch":1,"lastDecision":{"route":"graphql","reason":"healthy","successRate":0.98,"attempts":100,"newQueryIds":[],"alert":false}}'
);
insert into route_health.route_runs (region_id, apify_run_id, detail_route, at)
values ('probe-region', 'ProbeRun00000001', '{"route":"graphql","detailRequests":100,"detailOk":98}', now());
reset role;

-- route_runs.apify_run_id is unique, globally (not just per region) ----------------------------
do $$
begin
  set local role nabvy_pipeline;
  begin
    insert into route_health.route_runs (region_id, apify_run_id, detail_route, at)
    values ('another-region', 'ProbeRun00000001', '{"route":"graphql"}', now());
    raise exception 'a duplicate apify_run_id was accepted';
  exception when unique_violation then null;
  end;
  reset role;
end;
$$;

-- v_decisions: security_invoker, its column allowlist, and rows only while route-health is on --
insert into switches.switches (name, kind, state) values ('route-health', 'module', 'on')
  on conflict (name) do update set state = 'on';

do $$
declare
  cols text;
  seen integer;
  problems text;
begin
  select string_agg(column_name, ',' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'route_health' and table_name = 'v_decisions';
  if cols <> 'region_id,route,reason,success_rate,attempts,new_query_ids,alert,at' then
    raise exception 'v_decisions column list changed: %', cols;
  end if;

  select count(*) into seen from route_health.v_decisions where region_id = 'probe-region';
  if seen <> 1 then raise exception 'v_decisions is missing the region''s decision'; end if;

  select string_agg(view_name || ': ' || problem, '; ') into problems
  from nabvy_core.view_violations() where view_name like 'route\_health.%';
  if problems is not null then raise exception 'FAILED: view conventions: %', problems; end if;
end;
$$;

update switches.switches set state = 'off' where name = 'route-health';
select pg_temp.check(count(*) = 0, 'v_decisions still shows rows while route-health is off')
from route_health.v_decisions;

update switches.switches set state = 'shadow' where name = 'route-health';
select pg_temp.check(count(*) = 1, 'v_decisions must still show rows in shadow (rule 11: shadow behaves like on)')
from route_health.v_decisions;

update switches.switches set state = 'on' where name = 'route-health';

-- Grants: exactly nabvy_pipeline reads v_decisions, and the leak checks apify-gateway's file uses
do $$
declare
  readers text;
  role_name text;
  leak text;
begin
  select string_agg(grantee, ',' order by grantee) into readers
  from information_schema.role_table_grants
  where table_schema = 'route_health' and table_name = 'v_decisions' and privilege_type = 'SELECT'
    and grantee <> 'postgres';
  if readers <> 'nabvy_pipeline' then
    raise exception 'route_health.v_decisions readers changed: %', readers;
  end if;

  foreach role_name in array array['nabvy_app', 'anon', 'authenticated'] loop
    select string_agg(c.relname, ', ') into leak
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'route_health' and c.relkind in ('r', 'v', 'm')
      and (has_table_privilege(role_name, c.oid, 'select')
           or has_table_privilege(role_name, c.oid, 'insert')
           or has_table_privilege(role_name, c.oid, 'update')
           or has_table_privilege(role_name, c.oid, 'delete'));
    if leak is not null then raise exception 'FAILED: % holds privileges on %', role_name, leak; end if;
    if has_schema_privilege(role_name, 'route_health', 'usage') then
      raise exception 'FAILED: % can use the route_health schema', role_name;
    end if;
  end loop;
end;
$$;

select 'route-health module tests passed';
rollback;
