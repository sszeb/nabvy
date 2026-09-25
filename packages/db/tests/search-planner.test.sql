-- search-planner module (packages/db/migrations/search-planner): who may read and write, the
-- checks (no unapproved one-off run but a verification, one live verification per centre), the
-- switch on both views, and that no view carries a user ID. Runs in one transaction that is
-- rolled back, on a throwaway database only (scripts/db-dry-run.sh).
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

-- No Data API role reaches the schema, and the views follow the view conventions.
select pg_temp.check(not has_schema_privilege(r, 'search_planner', 'usage'),
  r || ' has no usage on search_planner')
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r;
select pg_temp.check(
  not exists (select 1 from nabvy_core.view_violations() where view_name like 'search_planner.%'),
  'search_planner views follow the view conventions');

-- Only the pipeline role reads and writes; one-off runs are never deleted.
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'search_planner.' || t, 'insert'),
  'pipeline inserts ' || t)
from unnest(array['plans', 'plan_terms', 'one_off_runs']) as t;
select pg_temp.check(not has_table_privilege('nabvy_pipeline', 'search_planner.one_off_runs', 'delete'),
  'pipeline cannot delete one-off runs');
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'search_planner.' || v, 'select'),
  'pipeline reads ' || v)
from unnest(array['v_plan', 'v_one_off_runs']) as v;
select pg_temp.check(not has_table_privilege(r, 'search_planner.' || v, 'select'),
  r || ' cannot read ' || v)
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r,
     unnest(array['v_plan', 'v_one_off_runs', 'plans', 'plan_terms', 'one_off_runs']) as v;

-- No user ID reaches a plan: no view or plan table has a user or approver column.
select pg_temp.check(not exists (
  select 1 from information_schema.columns
  where table_schema = 'search_planner'
    and table_name in ('plans', 'plan_terms', 'v_plan', 'v_one_off_runs')
    and (column_name like '%user%' or column_name = 'approved_by')),
  'no user ID on a plan table or view');

insert into switches.switches (name, kind, state) values ('search-planner', 'module', 'on')
on conflict (name) do update set state = excluded.state;

set local role nabvy_pipeline;

insert into search_planner.plans (centre_id, active) values ('101', true), ('202', false);
insert into search_planner.plan_terms (centre_id, term, origin, class, want_count, paid_want_count, in_budget, rank)
values
  ('101', 'rtx 3090', 'wants', 'narrow', 2, 1, true, 1),
  ('101', 'rtx 3090', 'admin-test', 'narrow', 0, 0, true, 1),
  ('101', 'pc', 'wants', 'broad', 2, 1, false, null),
  ('202', 'rtx 3080', 'wants', 'narrow', 1, 0, true, 2);

-- v_plan: active plans, in-budget pairs, one row per (centre, term) with both origins.
select pg_temp.check((select count(*) from search_planner.v_plan) = 1, 'v_plan shows one pair');
select pg_temp.check(
  (select origins from search_planner.v_plan where centre_id = '101' and term = 'rtx 3090')
    = array['admin-test', 'wants'],
  'v_plan merges origins');

-- Checks: a bad term, a paid count above the want count, a rank without the budget.
do $$
begin
  begin
    insert into search_planner.plan_terms (centre_id, term, origin, class) values ('101', 'RTX 3090', 'wants', 'narrow');
    raise exception 'FAILED: an upper-case term was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into search_planner.plan_terms (centre_id, term, origin, class, want_count, paid_want_count)
    values ('101', 'x', 'wants', 'narrow', 1, 2);
    raise exception 'FAILED: paid above wants was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into search_planner.plan_terms (centre_id, term, origin, class, in_budget, rank)
    values ('101', 'y', 'wants', 'narrow', false, 3);
    raise exception 'FAILED: a rank outside the budget was accepted';
  exception when check_violation then null;
  end;
  -- Any one-off run but a verification needs its approver.
  begin
    insert into search_planner.one_off_runs (purpose, input) values ('actor-test', '{}');
    raise exception 'FAILED: an unapproved actor-test run was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into search_planner.one_off_runs (purpose, input) values ('verification', '{}');
    raise exception 'FAILED: a verification without a centre was accepted';
  exception when check_violation then null;
  end;
  -- One live verification per centre; a failed one frees it.
  insert into search_planner.one_off_runs (purpose, input, centre_id)
    values ('verification', '{"centreId":"303","terms":["pc"]}', '303');
  begin
    insert into search_planner.one_off_runs (purpose, input, centre_id)
      values ('verification', '{"centreId":"303","terms":["pc"]}', '303');
    raise exception 'FAILED: a second live verification was accepted';
  exception when unique_violation then null;
  end;
  update search_planner.one_off_runs set status = 'failed' where centre_id = '303';
  insert into search_planner.one_off_runs (purpose, input, centre_id)
    values ('verification', '{"centreId":"303","terms":["pc"]}', '303');
end;
$$;

insert into search_planner.one_off_runs (purpose, input, approved_by)
values ('gap-fill', '{"listingIds":["1"]}', '00000000-0000-7000-8000-000000000001');
select pg_temp.check(
  (select count(*) from search_planner.v_one_off_runs where approved) = 1,
  'v_one_off_runs shows approval as a flag');

-- Off: both views are empty.
reset role;
update switches.switches set state = 'off' where name = 'search-planner';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from search_planner.v_plan) = 0, 'v_plan empty while off');
select pg_temp.check((select count(*) from search_planner.v_one_off_runs) = 0,
  'v_one_off_runs empty while off');

rollback;
