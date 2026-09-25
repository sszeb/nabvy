-- details-selector module (packages/db/migrations/details-selector): who may write, the unique
-- key and checks, the switch on the view and the privileges. Runs in one transaction that is
-- rolled back, on a throwaway database only (scripts/db-dry-run.sh).
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

insert into switches.switches (name, kind, state) values ('details-selector', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- Only the pipeline role writes; nabvy_app, anon and authenticated cannot even use the schema.
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'details_selector.selections', p),
  'pipeline ' || p || ' selections')
from unnest(array['select', 'insert', 'update', 'delete']) as p;
select pg_temp.check(not has_schema_privilege(r, 'details_selector', 'usage'),
  r || ' has no usage on details_selector')
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r;
select pg_temp.check(not has_table_privilege(r, 'details_selector.' || v, 'select'),
  r || ' cannot read ' || v)
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r,
     unnest(array['selections', 'v_selections']) as v;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'details_selector.v_selections', 'select'),
  'pipeline reads v_selections');
select pg_temp.check(
  not has_table_privilege('nabvy_pipeline', 'details_selector.v_selections', 'insert'),
  'pipeline cannot write through v_selections');

-- No user-facing views (rule 5): a selection is never shown to a user.
select pg_temp.check(not exists (
  select 1 from information_schema.views
  where table_schema = 'app' and table_name like 'v\_details\_selector%'), 'no app views');

-- The view is security_invoker with exactly its allowlisted columns.
select pg_temp.check(coalesce(c.reloptions @> array['security_invoker=true'], false),
  c.relname || ' is security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'details_selector' and c.relkind = 'v';
select pg_temp.check((
  select array_agg(column_name::text order by ordinal_position)
  from information_schema.columns
  where table_schema = 'details_selector' and table_name = 'v_selections')
  = array['source', 'source_listing_id', 'card_hash', 'reason', 'selected_at'],
  'v_selections columns');

-- One selection, written as the pipeline.
set local role nabvy_pipeline;
insert into details_selector.selections (source, source_listing_id, card_hash, reason, selected_at)
values ('facebook', '1816901372840238', repeat('a', 64), 'in_area', now());
reset role;

-- Unique key and checks: one row per (source, source listing ID, card hash); reason and card hash
-- are constrained; a second card version of the same listing is a new row.
do $$
begin
  begin
    insert into details_selector.selections
      (source, source_listing_id, card_hash, reason, selected_at)
    values ('facebook', '1816901372840238', repeat('a', 64), 'shipped', now());
    raise exception 'NOT REFUSED: a repeated (source, source_listing_id, card_hash)';
  exception when unique_violation then null;
  end;
  begin
    insert into details_selector.selections
      (source, source_listing_id, card_hash, reason, selected_at)
    values ('facebook', '1816901372840238', repeat('b', 64), 'auction', now());
    raise exception 'NOT REFUSED: unknown reason';
  exception when check_violation then null;
  end;
  begin
    insert into details_selector.selections
      (source, source_listing_id, card_hash, reason, selected_at)
    values ('facebook', '1816901372840238', 'not-a-hash', 'in_area', now());
    raise exception 'NOT REFUSED: a card hash that is not 64 hex characters';
  exception when check_violation then null;
  end;
end;
$$;

set local role nabvy_pipeline;
insert into details_selector.selections (source, source_listing_id, card_hash, reason, selected_at)
values ('facebook', '1816901372840238', repeat('c', 64), 'shipped', now());
select pg_temp.check((select count(*) from details_selector.v_selections) = 2,
  'v_selections shows both card versions');
reset role;

-- Shadow shows rows (no user-facing output); off empties the view.
update switches.switches set state = 'shadow' where name = 'details-selector';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from details_selector.v_selections) = 2,
  'v_selections shows rows in shadow');
reset role;
update switches.switches set state = 'off' where name = 'details-selector';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from details_selector.v_selections) = 0,
  'v_selections is empty while off');
reset role;

-- The foundation's view check passes for this schema.
select pg_temp.check(not exists (
  select 1 from nabvy_core.view_violations() v where v::text like '%details_selector%'),
  'no view violations in details_selector');

rollback;
