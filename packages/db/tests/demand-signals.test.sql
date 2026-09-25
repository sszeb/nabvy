-- demand-signals module (packages/db/migrations/demand-signals): who may write and what, the
-- unique key and the checks that keep every count under 10 out of the table, the switch on
-- v_cells, no user-facing view, no user or seller column, and the view conventions. Runs in one
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

-- Only the pipeline role writes, and only inserts: a week is written once and never rewritten.
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'demand_signals.cells', 'insert')
  and has_table_privilege('nabvy_pipeline', 'demand_signals.cells', 'select')
  and not has_table_privilege('nabvy_pipeline', 'demand_signals.cells', 'update')
  and not has_table_privilege('nabvy_pipeline', 'demand_signals.cells', 'delete')
  and not has_table_privilege('nabvy_pipeline', 'demand_signals.cells', 'truncate'),
  'pipeline inserts and reads cells, never rewrites or deletes them');
select pg_temp.check(not has_schema_privilege(r, 'demand_signals', 'usage'),
  r || ' has no usage on demand_signals')
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r;
select pg_temp.check(not has_table_privilege(r, 'demand_signals.' || v, 'select'),
  r || ' cannot read ' || v)
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r,
     unnest(array['cells', 'v_cells']) as v;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'demand_signals.v_cells', 'select'),
  'pipeline reads v_cells');

-- No user-facing view (card: "User-facing: none"), and no column names a user, a seller, a
-- listing or a point.
select pg_temp.check(not exists (
  select 1 from information_schema.views
  where table_schema = 'app' and table_name like 'v\_demand\_signals%'), 'no app views');
select pg_temp.check(not exists (
  select 1 from information_schema.columns
  where table_schema = 'demand_signals'
    and column_name ~* '(user|seller|listing|owner|email|name|lat|lng|postcode)'),
  'no user, seller, listing or location column');
select pg_temp.check(coalesce(c.reloptions @> array['security_invoker=true'], false),
  c.relname || ' is security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'demand_signals' and c.relkind = 'v';

-- The checks: no count under 10 is ever stored, suppressed is exactly "every count null", a
-- week starts on a Monday, and a cell is written once per week, centre, family and rule version.
set local role nabvy_pipeline;
insert into demand_signals.cells (week_start, centre_id, family, wants, adverts, suppressed,
  rule_version)
values ('2026-09-14', '110092169012550', 'rtx-3090', 12, 10, false, 'ds-1'),
       ('2026-09-14', '110092169012550', 'rtx-4090', null, null, true, 'ds-1');
reset role;

do $$
declare
  bad record;
begin
  for bad in
    select * from (values
      ('2026-09-14'::date, 'x1', 9, null::integer, false, 'wants under 10'),
      ('2026-09-14'::date, 'x2', null, 1, false, 'adverts under 10'),
      ('2026-09-14'::date, 'x3', 0, null, false, 'a zero count'),
      ('2026-09-14'::date, 'x4', null, null, false, 'all null but not suppressed'),
      ('2026-09-14'::date, 'x5', 12, null, true, 'suppressed with a count'),
      ('2026-09-15'::date, 'x6', 12, null, false, 'a Tuesday'),
      ('2026-09-14'::date, 'rtx-3090', 20, null, false, 'a second copy of a cell')
    ) as t (week_start, family, wants, adverts, suppressed, what)
  loop
    begin
      insert into demand_signals.cells (week_start, centre_id, family, wants, adverts, suppressed,
        rule_version)
      values (bad.week_start, '110092169012550', bad.family, bad.wants, bad.adverts,
        bad.suppressed, 'ds-1');
      raise exception 'FAILED: stored %', bad.what;
    exception
      when check_violation or unique_violation then null;
    end;
  end loop;
end;
$$;

-- The switch: v_cells is empty while the module is off, and shows the rows in shadow and on.
insert into switches.switches (name, kind, state) values ('demand-signals', 'module', 'off')
on conflict (name) do update set state = excluded.state;
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from demand_signals.v_cells) = 0, 'off: v_cells is empty');
reset role;
update switches.switches set state = 'shadow' where name = 'demand-signals';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from demand_signals.v_cells) = 2, 'shadow: v_cells has rows');
select pg_temp.check((select wants is null and adverts is null from demand_signals.v_cells
  where family = 'rtx-4090'), 'a suppressed cell shows no count');
reset role;

-- The view conventions (packages/db/README.md, "Views").
select pg_temp.check(not exists (
  select 1 from nabvy_core.view_violations() where view_name like 'demand_signals.%'),
  'demand_signals views keep the view conventions');

rollback;
