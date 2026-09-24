-- city-pages module (packages/db/migrations/city-pages): who may write, the unique keys and
-- checks, the switch on every view, the privileges, and the area-membership distance. Runs in one
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

insert into switches.switches (name, kind, state) values ('city-pages', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- The seed loaded 771 city pages, 5 of them verified centres, while the migration ran.
select pg_temp.check((select count(*) from city_pages.city_pages) = 771, 'seed loads 771 rows');
select pg_temp.check((select count(*) from city_pages.centres where verified) = 5,
  'seed verifies 5 centres');
select pg_temp.check((select count(*) from city_pages.centres where active) >= 25,
  'seed activates a national grid');
select pg_temp.check(
  (select active from city_pages.centres where city_page_id = '110769888951990') = false,
  'Dublin stays inactive while the beta is UK only');
select pg_temp.check(
  (select country, currency from city_pages.centres where city_page_id = '110769888951990')
    is not distinct from row('IE', 'EUR'), 'Dublin is IE/EUR');

-- Only the pipeline role writes, and never deletes; nabvy_app, anon and authenticated cannot
-- even use the schema.
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'city_pages.' || t, 'insert'),
  'pipeline inserts ' || t)
from unnest(array['city_pages', 'centres']) as t;
select pg_temp.check(not has_table_privilege('nabvy_pipeline', 'city_pages.' || t, 'delete'),
  'pipeline cannot delete ' || t)
from unnest(array['city_pages', 'centres']) as t;
select pg_temp.check(not has_schema_privilege(r, 'city_pages', 'usage'),
  r || ' has no usage on city_pages')
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'city_pages.' || v, 'select'),
  'pipeline reads ' || v)
from unnest(array['v_city_pages', 'v_centres', 'v_area_membership']) as v;
select pg_temp.check(not has_table_privilege(r, 'city_pages.' || v, 'select'),
  r || ' cannot read ' || v)
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r,
     unnest(array['v_city_pages', 'v_centres', 'v_area_membership']) as v;

-- No user-facing views (rule 5).
select pg_temp.check(not exists (
  select 1 from information_schema.views
  where table_schema = 'app' and table_name like 'v\_city\_pages%'), 'no app views');

-- Every view is security_invoker.
select pg_temp.check(coalesce(c.reloptions @> array['security_invoker=true'], false),
  c.relname || ' is security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'city_pages' and c.relkind = 'v';

-- A synthetic pair, well clear of the seed grid, to prove the distance and area-membership
-- logic: two city pages 30 km apart become each other's candidate centre, and a third 250 km
-- away from both is out of area for both (area_km defaults to 100 in the seed).
set local role nabvy_pipeline;
insert into city_pages.city_pages (city_page_id, name, towns, lat, lng, coord_source, first_seen_at)
values
  ('9001', 'Test Centre North', array['Test North'], 52.0, 0.0, 'seed', now()),
  ('9002', 'Test Near Town', array['Test Near'], 52.1, 0.0, 'seed', now()),
  ('9003', 'Test Far Town', array['Test Far'], 54.5, 0.0, 'seed', now()),
  ('9004', 'Test Card Added', array['Test Card'], null, null, 'card', now());
insert into city_pages.centres
  (city_page_id, active, verified, country, currency, reported_lat, reported_lng, area_km)
values ('9001', true, false, 'GB', 'GBP', null, null, 100);
reset role;

select pg_temp.check(
  (select centre_id from city_pages.v_area_membership where city_page_id = '9002') = '9001',
  'the near town''s nearest centre is the test centre');
select pg_temp.check(
  (select in_area from city_pages.v_area_membership where city_page_id = '9002') = true,
  'the near town is in area (about 11 km, under 100 km)');
select pg_temp.check(
  (select round((select distance_km from city_pages.v_area_membership
    where city_page_id = '9002')::numeric, 0) between 10 and 12),
  'the near town is about 11 km from the test centre');
select pg_temp.check(
  (select in_area from city_pages.v_area_membership where city_page_id = '9003') = false,
  'the far town (about 278 km) is out of area');
select pg_temp.check(
  (select centre_id from city_pages.v_area_membership where city_page_id = '9004') is null
  and (select distance_km from city_pages.v_area_membership where city_page_id = '9004') is null
  and (select in_area from city_pages.v_area_membership where city_page_id = '9004') = false,
  'a city page with no coordinate of its own gets no distance, never a guess');

-- Unique keys and checks: one row per city page; a centre only for a known city page; the
-- coordinate, country and currency vocabularies.
do $$
begin
  begin
    insert into city_pages.city_pages
      (city_page_id, name, towns, coord_source, first_seen_at)
    values ('9001', 'Duplicate', array[]::text[], 'seed', now());
    raise exception 'NOT REFUSED: duplicate city page';
  exception when unique_violation then null;
  end;
  begin
    insert into city_pages.centres (city_page_id, country, currency, area_km)
    values ('no-such-page', 'GB', 'GBP', 100);
    raise exception 'NOT REFUSED: centre with no city page';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into city_pages.city_pages
      (city_page_id, name, towns, lat, lng, coord_source, first_seen_at)
    values ('9005', 'Bad coord', array[]::text[], 999, 0, 'seed', now());
    raise exception 'NOT REFUSED: latitude out of range';
  exception when check_violation then null;
  end;
  begin
    insert into city_pages.centres (city_page_id, country, currency, area_km)
    values ('9002', 'FR', 'EUR', 100);
    raise exception 'NOT REFUSED: unknown country';
  exception when check_violation then null;
  end;
  begin
    insert into city_pages.centres (city_page_id, verified, verified_by_job, country, currency, area_km)
    values ('9003', false, 6, 'GB', 'GBP', 100);
    raise exception 'NOT REFUSED: verified_by_job without verified';
  exception when check_violation then null;
  end;
end;
$$;

-- Off: every view is empty.
update switches.switches set state = 'off' where name = 'city-pages';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from city_pages.v_city_pages) = 0
  and (select count(*) from city_pages.v_centres) = 0
  and (select count(*) from city_pages.v_area_membership) = 0, 'views are empty while off');
reset role;

-- The foundation's view check passes for this schema.
select pg_temp.check(not exists (
  select 1 from nabvy_core.view_violations() v where v::text like '%city_pages%'),
  'no view violations in city_pages');

rollback;
