-- listing-lifecycle module (packages/db/migrations/listing-lifecycle): who may write, the keys and
-- checks, the sent-once trigger, the switch on the view, and the privileges. Runs in one
-- transaction that is rolled back, on a throwaway database only (scripts/db-dry-run.sh).
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

insert into switches.switches (name, kind, state) values ('listing-lifecycle', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- Only the pipeline role writes; nabvy_app, anon and authenticated cannot even use the schema.
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'listing_lifecycle.' || t, p),
  'pipeline may ' || p || ' ' || t)
from unnest(array['status', 'rechecks']) as t,
     unnest(array['select', 'insert', 'update', 'delete']) as p;
select pg_temp.check(not has_schema_privilege(r, 'listing_lifecycle', 'usage'),
  r || ' has no usage on listing_lifecycle')
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r;
select pg_temp.check(not has_table_privilege(r, 'listing_lifecycle.' || v, 'select'),
  r || ' cannot read ' || v)
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r,
     unnest(array['status', 'rechecks', 'v_status']) as v;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'listing_lifecycle.v_status', 'select'),
  'pipeline reads v_status');
select pg_temp.check(not has_function_privilege('nabvy_app',
  'listing_lifecycle.rechecks_sent_once()', 'execute'), 'nabvy_app cannot run the trigger function');

-- No user-facing views (rule 5).
select pg_temp.check(not exists (
  select 1 from information_schema.views
  where table_schema = 'app' and table_name like 'v\_listing\_lifecycle%'), 'no app views');

-- Every view is security_invoker, and v_status has exactly the published columns.
select pg_temp.check(coalesce(c.reloptions @> array['security_invoker=true'], false),
  c.relname || ' is security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'listing_lifecycle' and c.relkind = 'v';
select pg_temp.check((
  select array_agg(column_name::text order by ordinal_position) from information_schema.columns
  where table_schema = 'listing_lifecycle' and table_name = 'v_status')
  = array['listing_id', 'source', 'source_listing_id', 'status', 'basis', 'last_seen_at',
          'observed_at', 'missed_sweeps', 'changed_at'], 'v_status columns');

set local role nabvy_pipeline;
insert into listing_lifecycle.status (listing_id, source, source_listing_id, status, basis,
  last_seen_at, observed_at, missed_sweeps, input_hash, changed_by)
values ('01920000-0000-7000-8000-000000000001', 'facebook', '28242423458759790', 'live',
  'search-card', '2026-09-24T01:40:43Z', '2026-09-24T01:40:43Z', 0, repeat('a', 64), 'test:1');
insert into listing_lifecycle.rechecks (listing_id, source, source_listing_id, reason, step,
  requested_by, due_at)
values ('01920000-0000-7000-8000-000000000001', 'facebook', '28242423458759790', 'alerted', 1,
  'notifier', '2026-09-24T07:40:43Z');
reset role;

-- Keys and checks: one status per listing; one pending step per listing, reason and step; the
-- vocabularies; a sent step keeps its outcome.
do $$
begin
  begin
    insert into listing_lifecycle.status (listing_id, source, source_listing_id, status, basis,
      input_hash, changed_by)
    values ('01920000-0000-7000-8000-000000000001', 'facebook', '1', 'live', 'search-card',
      repeat('b', 64), 't');
    raise exception 'NOT REFUSED: second status for a listing';
  exception when unique_violation then null;
  end;
  begin
    insert into listing_lifecycle.status (listing_id, source, source_listing_id, status, basis,
      input_hash, changed_by)
    values ('01920000-0000-7000-8000-000000000002', 'facebook', '2', 'sold', 'search-card',
      repeat('b', 64), 't');
    raise exception 'NOT REFUSED: "sold" is not a status (only the seller''s marked-sold)';
  exception when check_violation then null;
  end;
  begin
    insert into listing_lifecycle.rechecks (listing_id, source, source_listing_id, reason, step,
      requested_by, due_at)
    values ('01920000-0000-7000-8000-000000000001', 'facebook', '28242423458759790', 'alerted', 1,
      'notifier', now());
    raise exception 'NOT REFUSED: duplicate pending step';
  exception when unique_violation then null;
  end;
  begin
    insert into listing_lifecycle.rechecks (listing_id, source, source_listing_id, reason, step,
      requested_by, due_at, sent_at)
    values ('01920000-0000-7000-8000-000000000003', 'facebook', '3', 'watched', 0, 'watch',
      now(), now());
    raise exception 'NOT REFUSED: sent without an outcome';
  exception when check_violation then null;
  end;
  begin
    insert into listing_lifecycle.rechecks (listing_id, source, source_listing_id, reason, step,
      requested_by, due_at)
    values ('01920000-0000-7000-8000-000000000003', 'facebook', '3', 'watched', 0, 'Not A Module',
      now());
    raise exception 'NOT REFUSED: requested_by is not a module name';
  exception when check_violation then null;
  end;
end;
$$;

-- A sent step: a new schedule may be written beside it, and it cannot be sent again.
set local role nabvy_pipeline;
update listing_lifecycle.rechecks set sent_at = now(), outcome = 'queued'
where listing_id = '01920000-0000-7000-8000-000000000001';
insert into listing_lifecycle.rechecks (listing_id, source, source_listing_id, reason, step,
  requested_by, due_at)
values ('01920000-0000-7000-8000-000000000001', 'facebook', '28242423458759790', 'alerted', 1,
  'notifier', now());
reset role;
do $$
begin
  begin
    update listing_lifecycle.rechecks set outcome = 'skipped-unresolved'
    where listing_id = '01920000-0000-7000-8000-000000000001' and sent_at is not null;
    raise exception 'NOT REFUSED: a sent step rewritten';
  exception when check_violation then null;
  end;
end;
$$;

set local role nabvy_pipeline;
select pg_temp.check((select status from listing_lifecycle.v_status) = 'live', 'v_status shows rows while on');
reset role;

-- Shadow shows rows (no user-facing output); off empties the view.
update switches.switches set state = 'shadow' where name = 'listing-lifecycle';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from listing_lifecycle.v_status) = 1, 'v_status shows rows in shadow');
reset role;
update switches.switches set state = 'off' where name = 'listing-lifecycle';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from listing_lifecycle.v_status) = 0, 'v_status is empty while off');
reset role;

-- The foundation's view check passes for this schema.
select pg_temp.check(not exists (
  select 1 from nabvy_core.view_violations() v where v::text like '%listing_lifecycle%'),
  'no view violations in listing_lifecycle');

rollback;
