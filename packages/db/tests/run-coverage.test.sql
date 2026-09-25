-- run-coverage module (packages/db/migrations/run-coverage): who may write, the unique keys and
-- checks, the switch on every view and the privileges. Runs in one transaction that is rolled
-- back, on a throwaway database only (scripts/db-dry-run.sh).
\set ON_ERROR_STOP 1
\o /dev/null
begin;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'FAILED: %', what;
  end if;
end;
$$;

insert into switches.switches (name, kind, state) values ('run-coverage', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- Only the pipeline role writes, and never deletes; nabvy_app, anon and authenticated cannot
-- even use the schema.
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'run_coverage.' || t, 'insert'),
  'pipeline inserts ' || t)
from unnest(array['search_outcomes', 'scope_baselines']) as t;
select pg_temp.check(not has_table_privilege('nabvy_pipeline', 'run_coverage.' || t, 'delete'),
  'pipeline cannot delete ' || t)
from unnest(array['search_outcomes', 'scope_baselines']) as t;
select pg_temp.check(not has_schema_privilege(r, 'run_coverage', 'usage'),
  r || ' has no usage on run_coverage')
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'run_coverage.' || v, 'select'),
  'pipeline reads ' || v)
from unnest(array['v_search_coverage', 'v_scope_baselines', 'v_search_controls']) as v;
select pg_temp.check(not has_table_privilege(r, 'run_coverage.' || v, 'select'),
  r || ' cannot read ' || v)
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r,
     unnest(array['v_search_coverage', 'v_scope_baselines', 'v_search_controls']) as v;

-- No user-facing views (rule 5).
select pg_temp.check(not exists (
  select 1 from information_schema.views
  where table_schema = 'app' and table_name like 'v\_run\_coverage%'), 'no app views');

-- Every view is security_invoker.
select pg_temp.check(coalesce(c.reloptions @> array['security_invoker=true'], false),
  c.relname || ' is security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'run_coverage' and c.relkind = 'v';

set local role nabvy_pipeline;
insert into run_coverage.search_outcomes (job_id, search_index, centre_id, term, kind, route,
  stop_reason, reported_route, reported_stop_reason, pages, listings, binding, status,
  control_latitude, control_longitude, control_radius_km, control_sort, collected_at)
values (6, 0, '115935195086622', 'gaming pc', 'newest', 'http', 'results-limit', 'http',
  'results-limit', 1, 20, 'verified', 'capped', 50.836, -0.775, 65, 'CREATION_TIME_DESCEND',
  '2026-09-24T01:40:43Z');
insert into run_coverage.scope_baselines (centre_id, term, kind, basis, first_complete_at,
  job_id, search_index)
values ('115935195086622', 'gaming pc', 'newest', 'bounded', '2026-09-24T01:40:43Z', 6, 0);
reset role;

-- Unique keys and checks: one judgement per search of a job; one baseline per scope; the
-- status, route and stop-reason vocabularies.
do $$
begin
  begin
    insert into run_coverage.search_outcomes (job_id, search_index, kind, route, stop_reason,
      listings, status, collected_at)
    values (6, 0, 'newest', 'http', 'page-cap', 1, 'capped', now());
    raise exception 'NOT REFUSED: duplicate search';
  exception when unique_violation then null;
  end;
  begin
    insert into run_coverage.scope_baselines (centre_id, term, kind, basis, first_complete_at,
      job_id, search_index)
    values ('115935195086622', 'gaming pc', 'newest', 'complete', now(), 7, 0);
    raise exception 'NOT REFUSED: duplicate baseline';
  exception when unique_violation then null;
  end;
  begin
    insert into run_coverage.search_outcomes (job_id, search_index, kind, route, stop_reason,
      listings, status, collected_at)
    values (7, 0, 'newest', 'http', 'something-new', 1, 'capped', now());
    raise exception 'NOT REFUSED: raw stop reason';
  exception when check_violation then null;
  end;
  begin
    insert into run_coverage.search_outcomes (job_id, search_index, kind, route, stop_reason,
      listings, status, collected_at)
    values (7, 0, 'newest', 'http', 'page-cap', 1, 'fine', now());
    raise exception 'NOT REFUSED: unknown status';
  exception when check_violation then null;
  end;
end;
$$;

set local role nabvy_pipeline;
select pg_temp.check((select count(*) from run_coverage.v_search_coverage
  where status = 'capped' and done_at is not null) = 1, 'v_search_coverage shows the row');
select pg_temp.check((select radius_km from run_coverage.v_search_controls) = 65,
  'v_search_controls shows the reported radius');
select pg_temp.check((select basis from run_coverage.v_scope_baselines) = 'bounded',
  'v_scope_baselines shows the baseline');
reset role;

-- Off: every view is empty.
update switches.switches set state = 'off' where name = 'run-coverage';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from run_coverage.v_search_coverage) = 0
  and (select count(*) from run_coverage.v_scope_baselines) = 0
  and (select count(*) from run_coverage.v_search_controls) = 0, 'views are empty while off');
reset role;

-- The foundation's view check passes for this schema.
select pg_temp.check(not exists (
  select 1 from nabvy_core.view_violations() v where v::text like '%run_coverage%'),
  'no view violations in run_coverage');

rollback;
