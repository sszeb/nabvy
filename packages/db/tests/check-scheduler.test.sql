-- check-scheduler module (packages/db/migrations/check-scheduler): who may read and write, the
-- claim of one run per region per tick slot, a rerun once per degraded search, a one-off once
-- while live, the switch on the view, and that nothing carries a user ID. Runs in one transaction
-- that is rolled back, on a throwaway database only (scripts/db-dry-run.sh).
\set ON_ERROR_STOP 1
\o /dev/null
begin;
set local client_min_messages = warning;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'FAILED: %', what;
  end if;
end;
$$;

-- No Data API role or the web app reaches the schema, and the view follows the conventions.
select pg_temp.check(not has_schema_privilege(r, 'check_scheduler', 'usage'),
  r || ' has no usage on check_scheduler')
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r;
select pg_temp.check(
  not exists (select 1 from nabvy_core.view_violations() where view_name like 'check_scheduler.%'),
  'check_scheduler views follow the view conventions');

-- Only the pipeline role reads and writes; runs are the record of spend and are never deleted.
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'check_scheduler.' || t, 'insert'),
  'pipeline inserts ' || t)
from unnest(array['schedule', 'check_runs']) as t;
select pg_temp.check(not has_table_privilege('nabvy_pipeline', 'check_scheduler.check_runs', 'delete'),
  'pipeline cannot delete runs');
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'check_scheduler.v_check_runs', 'select'),
  'pipeline reads v_check_runs');
select pg_temp.check(not has_table_privilege(r, 'check_scheduler.' || v, 'select'),
  r || ' cannot read ' || v)
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r,
     unnest(array['v_check_runs', 'schedule', 'check_runs']) as v;

-- Never per user: no table or view has a user column.
select pg_temp.check(not exists (
  select 1 from information_schema.columns
  where table_schema = 'check_scheduler' and column_name like '%user%'),
  'no user ID in check_scheduler');

insert into switches.switches (name, kind, state) values ('check-scheduler', 'module', 'on')
on conflict (name) do update set state = excluded.state;

set local role nabvy_pipeline;

insert into check_scheduler.schedule (centre_id, term_class, kind, cadence_s, next_due_at)
values ('115935195086622', 'narrow', 'newest', 3600, '2026-09-25T13:00:00Z');
insert into check_scheduler.check_runs (centre_id, kind, shape, terms, reason, status, tick_at, job_id)
values ('115935195086622', 'newest', 'newest-check', '{rtx 3090}', 'scheduled', 'submitted',
        '2026-09-25T12:00:00Z', 1);
select pg_temp.check((select count(*) from check_scheduler.v_check_runs) = 1, 'v_check_runs shows the run');

do $$
begin
  -- One run per region per tick slot.
  begin
    insert into check_scheduler.check_runs (centre_id, kind, shape, terms, reason, status, tick_at, job_id)
    values ('115935195086622', 'sweep', 'sweep-narrow', '{rtx 3090}', 'scheduled', 'submitted',
            '2026-09-25T12:00:00Z', 2);
    raise exception 'FAILED: a second run in one slot was accepted';
  exception when unique_violation then null;
  end;
  -- A rerun once per degraded search.
  insert into check_scheduler.check_runs (centre_id, kind, shape, terms, reason, status, rerun_of)
  values ('115935195086622', 'newest', 'newest-check', '{pc}', 'rerun', 'pending',
          '01920000-0000-7000-8000-000000000001');
  begin
    insert into check_scheduler.check_runs (centre_id, kind, shape, terms, reason, status, rerun_of)
    values ('115935195086622', 'newest', 'newest-check', '{pc}', 'rerun', 'pending',
            '01920000-0000-7000-8000-000000000001');
    raise exception 'FAILED: a second rerun of one search was accepted';
  exception when unique_violation then null;
  end;
  -- A one-off once while live; a refused attempt does not hold it.
  insert into check_scheduler.check_runs (centre_id, kind, shape, terms, reason, status, tick_at, one_off_id, error_code)
  values ('109312942421526', 'newest', 'verification', '{pc}', 'verification', 'refused',
          '2026-09-25T12:05:00Z', '01920000-0000-7000-8000-000000000002', 'apify-gateway.refused');
  insert into check_scheduler.check_runs (centre_id, kind, shape, terms, reason, status, tick_at, job_id, one_off_id)
  values ('109312942421526', 'newest', 'verification', '{pc}', 'verification', 'submitted',
          '2026-09-25T12:10:00Z', 3, '01920000-0000-7000-8000-000000000002');
  begin
    insert into check_scheduler.check_runs (centre_id, kind, shape, terms, reason, status, tick_at, job_id, one_off_id)
    values ('109312942421526', 'newest', 'verification', '{pc}', 'verification', 'submitted',
            '2026-09-25T12:15:00Z', 4, '01920000-0000-7000-8000-000000000002');
    raise exception 'FAILED: a one-off was carried out twice';
  exception when unique_violation then null;
  end;
  -- Checks: a details shape, no terms, a submitted run without a job, an unknown reason.
  begin
    insert into check_scheduler.check_runs (centre_id, kind, shape, terms, reason, status, tick_at, job_id)
    values ('1', 'newest', 'details-text', '{pc}', 'scheduled', 'submitted', now(), 9);
    raise exception 'FAILED: a details shape was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into check_scheduler.check_runs (centre_id, kind, shape, terms, reason, status, tick_at, job_id)
    values ('1', 'newest', 'newest-check', '{}', 'scheduled', 'submitted', now(), 9);
    raise exception 'FAILED: a run with no terms was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into check_scheduler.check_runs (centre_id, kind, shape, terms, reason, status, tick_at)
    values ('1', 'newest', 'newest-check', '{pc}', 'scheduled', 'submitted', now());
    raise exception 'FAILED: a submitted run without a job was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into check_scheduler.check_runs (centre_id, kind, shape, terms, reason, status, tick_at)
    values ('1', 'newest', 'newest-check', '{pc}', 'per-user', 'shadow', now());
    raise exception 'FAILED: an unknown reason was accepted';
  exception when check_violation then null;
  end;
end;
$$;

-- Off: the view is empty.
reset role;
update switches.switches set state = 'off' where name = 'check-scheduler';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from check_scheduler.v_check_runs) = 0, 'v_check_runs is empty while off');

rollback;
