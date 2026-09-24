-- relist-merge module (packages/db/migrations/relist-merge): who may write, the unique key and
-- checks, the switch on the view and the privileges. Runs in one transaction that is rolled back,
-- on a throwaway database only (scripts/db-dry-run.sh).
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

insert into switches.switches (name, kind, state) values ('relist-merge', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- Only the pipeline role writes; nabvy_app, anon and authenticated cannot even use the schema.
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'relist_merge.' || t, p),
  'pipeline ' || p || ' ' || t)
from unnest(array['groups', 'members']) as t,
     unnest(array['select', 'insert', 'update', 'delete']) as p;
select pg_temp.check(not has_schema_privilege(r, 'relist_merge', 'usage'),
  r || ' has no usage on relist_merge')
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r;
select pg_temp.check(not has_table_privilege(r, 'relist_merge.' || v, 'select'),
  r || ' cannot read ' || v)
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r,
     unnest(array['groups', 'members', 'v_groups']) as v;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'relist_merge.v_groups', 'select'),
  'pipeline reads v_groups');
select pg_temp.check(not has_table_privilege('nabvy_pipeline', 'relist_merge.v_groups', 'insert'),
  'pipeline cannot write through v_groups');

-- No user-facing views (rule 5): no relist group ID or "relisted" reaches a user.
select pg_temp.check(not exists (
  select 1 from information_schema.views
  where table_schema = 'app' and table_name like 'v\_relist\_merge%'), 'no app views');

-- Every view is security_invoker; v_groups has exactly its allowlisted columns.
select pg_temp.check(coalesce(c.reloptions @> array['security_invoker=true'], false),
  c.relname || ' is security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'relist_merge' and c.relkind = 'v';
select pg_temp.check((
  select array_agg(column_name::text order by ordinal_position)
  from information_schema.columns
  where table_schema = 'relist_merge' and table_name = 'v_groups')
  = array['group_id', 'listing_id', 'basis', 'matched_listing_id', 'input_fetched_at',
          'merged_at', 'group_created_at'], 'v_groups columns');

-- One group of two listings, written as the pipeline.
set local role nabvy_pipeline;
insert into relist_merge.groups (id) values ('01920000-0000-7000-8000-00000000000a');
insert into relist_merge.members (group_id, listing_id, basis, matched_listing_id, input_fetched_at)
values
  ('01920000-0000-7000-8000-00000000000a', '01920000-0000-7000-8000-000000000001', 'origin',
   null, '2026-09-20T10:00:00Z'),
  ('01920000-0000-7000-8000-00000000000a', '01920000-0000-7000-8000-000000000002', 'description',
   '01920000-0000-7000-8000-000000000001', '2026-09-24T10:00:00Z');
reset role;

-- Unique key and checks: a listing is in one group only; the basis is known; only the origin has
-- no matched listing; a listing never matches itself.
do $$
begin
  begin
    insert into relist_merge.groups (id) values ('01920000-0000-7000-8000-00000000000b');
    insert into relist_merge.members (group_id, listing_id, basis, matched_listing_id,
      input_fetched_at)
    values ('01920000-0000-7000-8000-00000000000b', '01920000-0000-7000-8000-000000000002',
      'origin', null, now());
    raise exception 'NOT REFUSED: a listing in two groups';
  exception when unique_violation then null;
  end;
  begin
    insert into relist_merge.members (group_id, listing_id, basis, matched_listing_id,
      input_fetched_at)
    values ('01920000-0000-7000-8000-00000000000a', '01920000-0000-7000-8000-000000000003',
      'seller', '01920000-0000-7000-8000-000000000001', now());
    raise exception 'NOT REFUSED: unknown basis';
  exception when check_violation then null;
  end;
  begin
    insert into relist_merge.members (group_id, listing_id, basis, matched_listing_id,
      input_fetched_at)
    values ('01920000-0000-7000-8000-00000000000a', '01920000-0000-7000-8000-000000000003',
      'description', null, now());
    raise exception 'NOT REFUSED: a description member with no match';
  exception when check_violation then null;
  end;
  begin
    insert into relist_merge.members (group_id, listing_id, basis, matched_listing_id,
      input_fetched_at)
    values ('01920000-0000-7000-8000-00000000000a', '01920000-0000-7000-8000-000000000003',
      'photo', '01920000-0000-7000-8000-000000000003', now());
    raise exception 'NOT REFUSED: a listing matched to itself';
  exception when check_violation then null;
  end;
end;
$$;

set local role nabvy_pipeline;
select pg_temp.check((select count(*) from relist_merge.v_groups) = 2, 'v_groups shows both members');
select pg_temp.check((select count(distinct group_id) from relist_merge.v_groups) = 1,
  'one group');
reset role;

-- Shadow shows rows (no user-facing output); off empties the view.
update switches.switches set state = 'shadow' where name = 'relist-merge';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from relist_merge.v_groups) = 2, 'v_groups shows rows in shadow');
reset role;
update switches.switches set state = 'off' where name = 'relist-merge';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from relist_merge.v_groups) = 0, 'v_groups is empty while off');
reset role;

-- Deleting a group removes its members (erase of the last pair).
set local role nabvy_pipeline;
delete from relist_merge.groups where id = '01920000-0000-7000-8000-00000000000a';
select pg_temp.check((select count(*) from relist_merge.members) = 0, 'members go with their group');
reset role;

-- The foundation's view check passes for this schema.
select pg_temp.check(not exists (
  select 1 from nabvy_core.view_violations() v where v::text like '%relist_merge%'),
  'no view violations in relist_merge');

rollback;
