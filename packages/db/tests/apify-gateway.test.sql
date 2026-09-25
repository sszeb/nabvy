-- apify-gateway module (packages/db/migrations/apify-gateway): switches, tags, the monthly cap,
-- the build pin, the published views and privileges. The bootstrap's own checks (input rules,
-- reservations, collect jobs, redaction) stay in supabase/tests/apify-gateway.test.sql. Runs in
-- one transaction that is rolled back, on a throwaway database only (scripts/db-dry-run.sh).
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

-- Expects `statement` to fail with a message containing `expected`.
create function pg_temp.refuses(statement text, expected text, what text) returns void
language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if position(expected in sqlerrm) = 0 then
      raise exception 'FAILED: % (wrong error: %)', what, sqlerrm;
    end if;
    return;
  end;
  raise exception 'NOT REFUSED: %', what;
end;
$$;

delete from apify_gateway.items;
delete from apify_gateway.jobs;

create temporary table good as select
  '{"inputVersion":3,"searchTerms":["gaming pc"],"cityId":"115935195086622","sort":"newest",
    "includeDetails":false,"maxListings":30,"maxRequests":3,"maxRunSeconds":120,
    "browserFallback":false,"useDetailCache":false,"sourceDiagnostics":true,
    "proxyConfiguration":{"useApifyProxy":true,"apifyProxyGroups":["RESIDENTIAL"],"apifyProxyCountry":"GB"}}'::jsonb
    as input,
  '{"module":"check-scheduler","region":"chichester","purpose":"newest-check","shape":"newest-check"}'::jsonb
    as tags;
grant select on good to nabvy_pipeline;

-- 1. Settings: the build pin and the monthly cap. ------------------------------------------------
select pg_temp.check(actor_build = '1.0.83', 'the build is pinned at 1.0.83')
from apify_gateway.settings;
select pg_temp.check(cap_usd = 150, 'the cap is $150') from apify_gateway.settings;
select pg_temp.refuses($$update apify_gateway.settings set actor_build = 'latest'$$,
  'settings_actor_build', 'a build tag other than a version number');

-- 2. Off by default: nothing queued through the pipeline path, nothing claimed. ------------------
select pg_temp.check(not apify_gateway.enabled(), 'the gateway is off while its switches are off');
select pg_temp.refuses(
  $$select apify_gateway.enqueue_run((select input from good), 1024, 180, 'off', (select tags from good))$$,
  'switched off', 'a run queued while the gateway is off');
insert into apify_gateway.jobs (kind, note) values ('env_check', 'queued while off');
select pg_temp.check(count(*) = 0, 'nothing is claimed while the gateway is off')
from apify_gateway.claim_next_job();

insert into switches.switches (name, kind, state) values ('apify-gateway', 'module', 'on')
  on conflict (name) do update set state = 'on';
select pg_temp.check(not apify_gateway.enabled(), 'the provider switch apify still holds it off');
update switches.switches set state = 'on' where name = 'apify';
select pg_temp.check(apify_gateway.enabled(), 'module and provider on: the gateway works');
update switches.switches set state = 'off' where name = 'pipeline';
select pg_temp.check(not apify_gateway.enabled(), 'the global pipeline pause stops the gateway');
update switches.switches set state = 'on' where name = 'pipeline';
update switches.switches set state = 'shadow' where name = 'apify-gateway';
select pg_temp.check(apify_gateway.enabled(), 'shadow runs and writes (rule 11)');
update switches.switches set state = 'on' where name = 'apify-gateway';
select pg_temp.check(note = 'queued while off', 'a job queued while off is claimed once on')
from apify_gateway.claim_next_job();

-- 3. Tags. ---------------------------------------------------------------------------------------
do $$
declare
  good_tags jsonb := (select tags from good);
  bad record;
begin
  for bad in select * from (values
    ('[]'::jsonb, 'tags must be a JSON object', 'tags not an object'),
    (good_tags || '{"user":"x"}', 'tags.user is not allowed', 'an unknown tag'),
    (good_tags - 'module', 'tags.module', 'no requesting module'),
    (good_tags || '{"module":"Check Scheduler"}', 'tags.module', 'module not kebab case'),
    (good_tags - 'region', 'tags.region', 'no region'),
    (good_tags || '{"purpose":""}', 'tags.purpose', 'empty purpose'),
    (good_tags || '{"shape":7}', 'tags.shape', 'shape not a string')
  ) as t (tags, expected, label) loop
    perform pg_temp.refuses(
      format('select apify_gateway.enqueue_run(%L::jsonb, 1024, 180, %L, %L::jsonb)',
        (select input from good), bad.label, bad.tags),
      bad.expected, bad.label);
  end loop;
end;
$$;
-- The owner's checks still apply through the five-argument version.
select pg_temp.refuses(
  $$select apify_gateway.enqueue_run((select input || '{"useDetailCache":true}' from good), 1024, 180, 'x', (select tags from good))$$,
  'useDetailCache', 'the input rules of the four-argument version');

-- 4. Queueing as the pipeline. -------------------------------------------------------------------
set local role nabvy_pipeline;
select apify_gateway.enqueue_run((select input from good), 1024, 180, 'newest', (select tags from good));
select pg_temp.check(count(*) = 1, 'the pipeline can invoke the gateway') from (select apify_gateway.invoke()) t;
reset role;
select pg_temp.check(
  kind = 'run' and status = 'pending' and tags = (select tags from good) and reserve_usd > 0,
  'a pipeline run is queued with its tags and a reservation')
from apify_gateway.jobs where note = 'newest';

-- 5. The monthly cap counts only this month's runs (Europe/London). ------------------------------
select pg_temp.check(
  apify_gateway.spend_month('2026-09-30 23:30:00+01') = date '2026-09-01'
  and apify_gateway.spend_month('2026-09-30 23:30:00+00') = date '2026-10-01'
  and apify_gateway.spend_month('2026-12-31 23:59:59+00') = date '2026-12-01'
  and apify_gateway.spend_month('2027-01-01 00:00:00+00') = date '2027-01-01',
  'months change at midnight London time');
insert into apify_gateway.jobs (kind, status, reserve_usd, apify_run_id, cost_usd, note, created_at)
values
  -- Started 30 minutes before this month began and still unsettled: counts in last month only.
  ('run', 'running', 149.0000, 'LastMonthRun00001', null, 'last day of last month',
   (date_trunc('month', now() at time zone 'Europe/London') - interval '30 minutes')
     at time zone 'Europe/London'),
  -- Settled last month at more than its reservation: still last month's.
  ('run', 'succeeded', 1.0000, 'LastMonthRun00002', 140.0000, 'settled last month',
   (date_trunc('month', now() at time zone 'Europe/London') - interval '2 days')
     at time zone 'Europe/London');
update apify_gateway.jobs set settled_at = now() where note = 'settled last month';
select pg_temp.check(committed_usd = 0 and remaining_usd = 150
    and month = date_trunc('month', now() at time zone 'Europe/London')::date,
  'last month''s runs, settled or not, do not count this month')
from apify_gateway.spend;
-- Paid work pauses while the cost meter is off (rule 11); the one pending job is a run.
select pg_temp.check(count(*) = 0, 'no run is claimed while cost-meter is off')
from apify_gateway.claim_next_job();
update switches.switches set state = 'on' where name = 'cost-meter';
select pg_temp.check(kind = 'run' and status = 'running' and claimed_at is not null,
  'a run fits under this month''s cap, and records when it was claimed')
from apify_gateway.claim_next_job();
select pg_temp.check(committed_usd = (select reserve_usd from apify_gateway.jobs where note = 'newest'),
  'this month''s running run counts at its reservation')
from apify_gateway.spend;
update apify_gateway.jobs set created_at = now() where note = 'last day of last month';
insert into apify_gateway.jobs (kind, input, run_options, reserve_usd, note)
values ('run', (select input from good), '{"memory":1024,"timeout":180}', 1.0000, 'over the cap');
select pg_temp.check(status = 'refused' and error like 'spend cap:%',
  'a run past the monthly cap is refused')
from apify_gateway.claim_next_job();
delete from apify_gateway.jobs where note in ('last day of last month', 'settled last month', 'over the cap');

-- A backlog queued late last month and claimed this month is charged to this month, the month the
-- cap checked it against, so it cannot slip between the two caps (review of PR #29).
insert into apify_gateway.jobs (kind, input, run_options, reserve_usd, note, created_at)
select 'run', (select input from good), '{"memory":1024,"timeout":180}', 100.0000, n,
  (date_trunc('month', now() at time zone 'Europe/London') - interval '10 minutes')
    at time zone 'Europe/London'
from unnest(array['backlog 1', 'backlog 2']) as n;
select pg_temp.check(note = 'backlog 1' and status = 'running', 'the first backlog run is claimed')
from apify_gateway.claim_next_job();
select pg_temp.check(
  committed_usd = 100 + (select reserve_usd from apify_gateway.jobs where note = 'newest'),
  'a run queued last month and claimed this month counts this month')
from apify_gateway.spend;
select pg_temp.check(note = 'backlog 2' and status = 'refused' and error like 'spend cap:%',
  'the second backlog run is refused once this month''s cap is reached')
from apify_gateway.claim_next_job();
delete from apify_gateway.jobs where note like 'backlog %';

-- 6. Published views. ----------------------------------------------------------------------------
insert into apify_gateway.jobs (kind, status, input, apify_run_id, result, note)
values ('collect', 'succeeded', '{"apifyRunId":"TestRunId00000001"}', 'TestRunId00000001',
  '{"startedAt":"2026-09-24T01:40:18.718Z","finishedAt":"2026-09-24T01:40:44.010Z","itemCount":2,
    "runSummary":{"searches":[{"term":"gaming pc"}],"detailRoute":{"route":"graphql"}}}',
  'collected');
insert into apify_gateway.items (job_id, seq, item)
select id, 0, '{"recordType":"listing","listingId":"28242423458759790","title":"PC",
  "seller":{"id":"123","name":"Someone"},
  "sourceFields":{"item":{"marketplace_listing_seller":{"id":"123"},"photos":[{"seller":{"name":"x"},"uri":"u"}]}}}'::jsonb
from apify_gateway.jobs where note = 'collected'
union all
select id, 1, '{"recordType":"sourceOutcome","seller":null}'::jsonb
from apify_gateway.jobs where note = 'collected';

set local role nabvy_pipeline;
select pg_temp.check(count(*) = 2, 'the pipeline reads v_rows') from apify_gateway.v_rows;
select pg_temp.check(bool_and(item::text not like '%"seller"%'
    and item::text not like '%marketplace_listing_seller%'),
  'v_rows never holds a seller key, at any depth')
from apify_gateway.v_rows;
select pg_temp.check(item -> 'sourceFields' -> 'item' -> 'photos' -> 0 ->> 'uri' = 'u'
    and listing_id = '28242423458759790' and record_type = 'listing',
  'v_rows keeps everything else, IDs as text')
from apify_gateway.v_rows where seq = 0;
select pg_temp.check(array_agg(present order by seq) = array[true, false],
  'v_seller_presence says whether a row has a seller, and nothing more')
from apify_gateway.v_seller_presence;
select pg_temp.check(item -> 'seller' ->> 'name' = 'Someone', 'restricted_rows holds whole rows')
from apify_gateway.restricted_rows where seq = 0;
select pg_temp.check(run_kind = 'search' and item_count = 2 and finished_at is not null,
  'v_jobs derives the run kind of a collect job from RUN_SUMMARY')
from apify_gateway.v_jobs where apify_run_id = 'TestRunId00000001';
select pg_temp.check(run_kind = 'search', 'v_jobs derives the run kind of a run from its input')
from apify_gateway.v_jobs where kind = 'run';
select pg_temp.check(detail_route ->> 'route' = 'graphql' and jsonb_array_length(searches) = 1,
  'v_run_summaries exposes RUN_SUMMARY')
from apify_gateway.v_run_summaries;

reset role;
update switches.switches set state = 'off' where name = 'apify-gateway';
set local role nabvy_pipeline;
select pg_temp.check(
  (select count(*) from apify_gateway.v_rows) = 0
  and (select count(*) from apify_gateway.v_jobs) = 0
  and (select count(*) from apify_gateway.v_run_summaries) = 0
  and (select count(*) from apify_gateway.v_seller_presence) = 0,
  'the v_ views return no rows while the module is off');
select pg_temp.check(count(*) = 2, 'restricted_rows still reaches every row (erasure)')
from apify_gateway.restricted_rows;
reset role;
update switches.switches set state = 'on' where name = 'apify-gateway';
set local role nabvy_pipeline;

-- The watcher's times: the pipeline may set them once, and change nothing else.
update apify_gateway.jobs set announced_at = now() where apify_run_id = 'TestRunId00000001';
select pg_temp.refuses($$update apify_gateway.jobs set status = 'failed'$$,
  'permission denied', 'the pipeline changing a job''s status');
select pg_temp.refuses($$insert into apify_gateway.jobs (kind) values ('env_check')$$,
  'permission denied', 'the pipeline inserting a job directly');
select pg_temp.refuses($$select * from apify_gateway.settings$$,
  'permission denied', 'the pipeline reading settings');
select pg_temp.refuses($$select apify_gateway.enqueue_run('{}'::jsonb, 1024, 180, 'x')$$,
  'permission denied', 'the pipeline calling the owner''s four-argument enqueue_run');
reset role;
select pg_temp.refuses(
  $$update apify_gateway.jobs set announced_at = now() + interval '1 day' where apify_run_id = 'TestRunId00000001'$$,
  'never changes', 'moving a watcher time once set');

select pg_temp.check(apify_gateway.run_kind('run', '{"listingIds":["1"]}', null) = 'details'
    and apify_gateway.run_kind('collect', '{}', '{"runSummary":{"searches":[]}}') = 'details'
    and apify_gateway.run_kind('env_check', '{}', null) is null,
  'run kinds: listingIds are details; a collect job with no searches is details');

-- 7. Conventions and privileges. -----------------------------------------------------------------
do $$
declare
  problems text;
begin
  select string_agg(view_name || ': ' || problem, '; ') into problems
  from nabvy_core.view_violations() where view_name like 'apify\_gateway.%';
  if problems is not null then raise exception 'FAILED: view conventions: %', problems; end if;
end;
$$;

do $$
declare
  role_name text;
  leak text;
begin
  foreach role_name in array array['nabvy_app', 'anon', 'authenticated'] loop
    select string_agg(c.relname, ', ') into leak
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'apify_gateway' and c.relkind in ('r', 'v', 'm')
      and (has_table_privilege(role_name, c.oid, 'select')
           or has_table_privilege(role_name, c.oid, 'insert')
           or has_table_privilege(role_name, c.oid, 'update')
           or has_table_privilege(role_name, c.oid, 'delete'));
    if leak is not null then raise exception 'FAILED: % holds privileges on %', role_name, leak; end if;
    select string_agg(p.oid::regprocedure::text, ', ') into leak
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'apify_gateway' and has_function_privilege(role_name, p.oid, 'execute');
    if leak is not null then raise exception 'FAILED: % can execute %', role_name, leak; end if;
    if has_schema_privilege(role_name, 'apify_gateway', 'usage') then
      raise exception 'FAILED: % can use the apify_gateway schema', role_name;
    end if;
  end loop;
  -- The pipeline holds exactly the functions it needs.
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into leak
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'apify_gateway' and has_function_privilege('nabvy_pipeline', p.oid, 'execute')
    and p.oid::regprocedure::text not in (
      'apify_gateway.enqueue_run(jsonb,integer,integer,text,jsonb)',
      'apify_gateway.invoke()',
      'apify_gateway.without_seller(jsonb)',
      'apify_gateway.run_kind(text,jsonb,jsonb)');
  if leak is not null then raise exception 'FAILED: the pipeline can also execute %', leak; end if;
  if has_table_privilege('nabvy_pipeline', 'apify_gateway.settings', 'select')
    or has_table_privilege('nabvy_pipeline', 'apify_gateway.spend', 'select')
    or has_table_privilege('nabvy_pipeline', 'apify_gateway.items', 'insert')
    or has_table_privilege('nabvy_pipeline', 'apify_gateway.jobs', 'delete')
  then
    raise exception 'FAILED: the pipeline holds more than reads and the watcher times';
  end if;
end;
$$;

\o
select 'apify-gateway module tests passed';
rollback;
