-- source-health module tests, run by pnpm db:dry-run (packages/db/README.md; global view and
-- Data API checks run once for every module in tests/core.test.sql).
begin;
set local client_min_messages = warning;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'FAILED: %', what;
  end if;
end;
$$;

-- nabvy_app has no privilege at all: source-health holds no user rows and no user-facing view --
do $$
begin
  set local role nabvy_app;
  begin
    insert into source_health.health_daily (day) values ('2026-09-24');
    raise exception 'nabvy_app inserted into health_daily';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

do $$
begin
  set local role nabvy_app;
  begin
    perform 1 from source_health.v_health;
    raise exception 'nabvy_app could read v_health';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

-- nabvy_pipeline: exactly the intended grants (select/insert/update on health_daily;
-- select/insert on ramp and processed_jobs — both append-only, never updated or deleted) -------
do $$
begin
  set local role nabvy_pipeline;
  begin
    delete from source_health.health_daily where day = 'nope';
    raise exception 'nabvy_pipeline deleted from health_daily';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

do $$
begin
  set local role nabvy_pipeline;
  begin
    update source_health.ramp set stage = 9 where id = gen_random_uuid();
    raise exception 'nabvy_pipeline updated ramp';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from source_health.ramp where stage = 9;
    raise exception 'nabvy_pipeline deleted from ramp';
  exception when insufficient_privilege then null;
  end;
  begin
    update source_health.processed_jobs set day = 'nope' where job_id = -1;
    raise exception 'nabvy_pipeline updated processed_jobs';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from source_health.processed_jobs where job_id = -1;
    raise exception 'nabvy_pipeline deleted from processed_jobs';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

set local role nabvy_pipeline;
insert into source_health.health_daily (
  day, total_searches, degraded_searches, breaker_trips, new_operation_ids, blocked_pages, alerted
) values (
  'probe-day', 10, 2, 1, '["q1"]'::jsonb, '[true,false]'::jsonb, '["degraded-spike"]'::jsonb
);
insert into source_health.processed_jobs (job_id, day) values (1, 'probe-day'), (2, 'probe-day');
insert into source_health.ramp (stage, started_at, max_checks_per_day, advanced_by)
values (0, now() - interval '2 days', 50, null);
insert into source_health.ramp (stage, started_at, max_checks_per_day, advanced_by)
values (1, now(), 100, 'probe-day');
reset role;

-- processed_jobs dedupes on the job ID across days: a second claim of job 1 on another day is a
-- conflict, and `on conflict do nothing` inserts nothing (the handler's replay guard) ----------
with claimed as (
  insert into source_health.processed_jobs (job_id, day) values (1, 'another-day')
  on conflict (job_id) do nothing returning job_id
)
select pg_temp.check(count(*) = 0, 'a replayed job ID on another day was claimed again')
from claimed;
select pg_temp.check(
  (select day from source_health.processed_jobs where job_id = 1) = 'probe-day',
  'the replay moved job 1 to another day');

-- ramp.stage is unique: a second row for stage 1 is refused, and a racing insert with
-- `on conflict (stage) do nothing` inserts nothing -----------------------------------------------
do $$
begin
  begin
    insert into source_health.ramp (stage, started_at, max_checks_per_day, advanced_by)
    values (1, now(), 100, 'probe-day');
    raise exception 'ramp accepted a second row for stage 1';
  exception when unique_violation then null;
  end;
end;
$$;
with raced as (
  insert into source_health.ramp (stage, started_at, max_checks_per_day, advanced_by)
  values (1, now(), 100, 'probe-day') on conflict (stage) do nothing returning stage
)
select pg_temp.check(count(*) = 0, 'a racing advance to stage 1 inserted a second row')
from raced;
select pg_temp.check(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'source_health' and table_name = 'health_daily'
      and column_name = 'processed_job_ids'),
  'health_daily.processed_job_ids still exists (replaced by processed_jobs)');

-- v_health: security_invoker, its column allowlist, the computed pct_degraded, and rows only
-- while source-health is on ---------------------------------------------------------------------
insert into switches.switches (name, kind, state) values ('source-health', 'module', 'on')
  on conflict (name) do update set state = 'on';

do $$
declare
  cols text;
  pct numeric;
  problems text;
begin
  select string_agg(column_name, ',' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'source_health' and table_name = 'v_health';
  if cols <> 'day,total_searches,degraded_searches,pct_degraded,breaker_trips,new_operation_ids,blocked_pages,alerted,updated_at' then
    raise exception 'v_health column list changed: %', cols;
  end if;

  select pct_degraded into pct from source_health.v_health where day = 'probe-day';
  if pct <> 0.2000 then raise exception 'v_health.pct_degraded miscomputed: %', pct; end if;

  select string_agg(view_name || ': ' || problem, '; ') into problems
  from nabvy_core.view_violations() where view_name like 'source\_health.%';
  if problems is not null then raise exception 'FAILED: view conventions: %', problems; end if;
end;
$$;

-- v_ramp_stage: exactly one row, the latest stage by started_at -------------------------------
do $$
declare
  seen integer;
  latest_stage integer;
begin
  select count(*), max(stage) into seen, latest_stage from source_health.v_ramp_stage;
  if seen <> 1 then raise exception 'v_ramp_stage must show exactly the current stage, saw %', seen; end if;
  if latest_stage <> 1 then raise exception 'v_ramp_stage picked the wrong stage: %', latest_stage; end if;
end;
$$;

update switches.switches set state = 'off' where name = 'source-health';
select pg_temp.check(count(*) = 0, 'v_health still shows rows while source-health is off')
from source_health.v_health;
select pg_temp.check(count(*) = 0, 'v_ramp_stage still shows a row while source-health is off')
from source_health.v_ramp_stage;

update switches.switches set state = 'shadow' where name = 'source-health';
select pg_temp.check(count(*) = 1, 'v_health must still show rows in shadow (rule 11: shadow behaves like on)')
from source_health.v_health;

update switches.switches set state = 'on' where name = 'source-health';

-- Grants: exactly nabvy_pipeline reads the views, and the leak checks apify-gateway's file uses --
do $$
declare
  readers text;
  role_name text;
  leak text;
begin
  select string_agg(grantee, ',' order by grantee) into readers
  from information_schema.role_table_grants
  where table_schema = 'source_health' and table_name = 'v_health' and privilege_type = 'SELECT'
    and grantee <> 'postgres';
  if readers <> 'nabvy_pipeline' then
    raise exception 'source_health.v_health readers changed: %', readers;
  end if;

  foreach role_name in array array['nabvy_app', 'anon', 'authenticated'] loop
    select string_agg(c.relname, ', ') into leak
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'source_health' and c.relkind in ('r', 'v', 'm')
      and (has_table_privilege(role_name, c.oid, 'select')
           or has_table_privilege(role_name, c.oid, 'insert')
           or has_table_privilege(role_name, c.oid, 'update')
           or has_table_privilege(role_name, c.oid, 'delete'));
    if leak is not null then raise exception 'FAILED: % holds privileges on %', role_name, leak; end if;
    if has_schema_privilege(role_name, 'source_health', 'usage') then
      raise exception 'FAILED: % can use the source_health schema', role_name;
    end if;
  end loop;
end;
$$;

select 'source-health module tests passed';
rollback;
