-- noise-filter module (packages/db/migrations/noise-filter): who may write, the unique key and
-- checks, the latest row per version, the switch on every view, the user-facing view's exact
-- columns, its suppression anti-join and its row-level guard, and the privileges. Runs in one
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

insert into switches.switches (name, kind, state)
values ('noise-filter', 'module', 'on'), ('listing-suppression', 'module', 'on'),
       ('listing-ingest', 'module', 'on'), ('detail-evidence', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- Only the pipeline role writes; anon and authenticated cannot use the schema; nabvy_app reads
-- only the four columns the user-facing view reads, and writes nothing.
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'noise_filter.classifications', p),
  'pipeline may ' || p)
from unnest(array['select', 'insert', 'delete']) as p;
select pg_temp.check(not has_table_privilege('nabvy_pipeline', 'noise_filter.classifications', 'update'),
  'pipeline has no table-wide update');
select pg_temp.check(
  has_column_privilege('nabvy_pipeline', 'noise_filter.classifications', 'classified_at', 'update')
  and not has_column_privilege('nabvy_pipeline', 'noise_filter.classifications', 'reasons', 'update'),
  'pipeline updates classified_at only');
select pg_temp.check(not has_schema_privilege(r, 'noise_filter', 'usage'),
  r || ' has no usage on noise_filter')
from unnest(array['anon', 'authenticated']) as r;
select pg_temp.check(not has_any_column_privilege('nabvy_app', 'noise_filter.classifications', p),
  'nabvy_app cannot ' || p)
from unnest(array['insert', 'update']) as p;
select pg_temp.check(not has_table_privilege('nabvy_app', 'noise_filter.classifications', 'delete'),
  'nabvy_app cannot delete');
select pg_temp.check(has_column_privilege('nabvy_app', 'noise_filter.classifications', c, 'select'),
  'nabvy_app reads classifications.' || c)
from unnest(array['id', 'listing_id', 'reasons', 'classified_at']) as c;
select pg_temp.check(not has_column_privilege('nabvy_app', 'noise_filter.classifications', c, 'select'),
  'nabvy_app cannot read classifications.' || c)
from unnest(array['evidence_hash', 'input_hash', 'rule_version', 'evidence', 'terms', 'fetched_at']) as c;
select pg_temp.check(not has_table_privilege(r, 'noise_filter.v_classifications', 'select'),
  r || ' cannot read v_classifications')
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'noise_filter.v_classifications', 'select'),
  'pipeline reads v_classifications');

-- The user-facing view: granted to nabvy_app and to no other application role (rule 5), with
-- exactly the allowed columns: the listing and its reason codes.
select pg_temp.check(has_table_privilege('nabvy_app', 'app.v_noise_filter_reasons', 'select'),
  'nabvy_app reads app.v_noise_filter_reasons');
select pg_temp.check(not has_table_privilege(r, 'app.v_noise_filter_reasons', 'select'),
  r || ' cannot read app.v_noise_filter_reasons')
from unnest(array['nabvy_pipeline', 'anon', 'authenticated']) as r;
select pg_temp.check(not has_schema_privilege(r, 'app', 'usage'), r || ' has no usage on app')
from unnest(array['anon', 'authenticated']) as r;
select pg_temp.check((
  select array_agg(column_name::text order by ordinal_position)
  from information_schema.columns
  where table_schema = 'app' and table_name = 'v_noise_filter_reasons')
  = array['listing_id', 'reasons'],
  'app.v_noise_filter_reasons has exactly the allowed columns');

-- Every view is security_invoker.
select pg_temp.check(coalesce(c.reloptions @> array['security_invoker=true'], false),
  n.nspname || '.' || c.relname || ' is security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where (n.nspname = 'noise_filter' or (n.nspname = 'app' and c.relname = 'v_noise_filter_reasons'))
  and c.relkind = 'v';

-- Three listings known to listing-ingest, the third suppressed.
insert into listing_ingest.listings (id, source, source_listing_id, card_hash, price_minor,
  currency, title, first_fetched_at, last_seen_at, city_page_id, availability, item_job_id, item_seq)
values
  ('01920000-0000-7000-8000-0000000000b1', 'facebook', 'nf-1', repeat('a', 64), 20000, 'GBP',
   'WANTED gaming PC', now(), now(), '115935195086622', 'live', 1, 0),
  ('01920000-0000-7000-8000-0000000000b2', 'facebook', 'nf-2', repeat('b', 64), 15000, 'GBP',
   'Gaming PC', now(), now(), '115935195086622', 'live', 1, 1),
  ('01920000-0000-7000-8000-0000000000b3', 'facebook', 'nf-3', repeat('c', 64), 2500, 'GBP',
   'PC repair service', now(), now(), '115935195086622', 'live', 1, 2);
insert into listing_suppression.entries (kind, value, request_id)
values ('listing_hash', listing_suppression.listing_hash('facebook', 'nf-3'),
  '00000000-0000-7000-8000-000000000042');

-- Classifications, written as the pipeline role: listing 1 has an older clean row and a later
-- `wanted` row for the same version; listing 2 is clean; listing 3 is a suppressed service.
set local role nabvy_pipeline;
insert into noise_filter.classifications (listing_id, evidence_hash, input_hash, rule_version,
  reasons, evidence, terms, fetched_at, classified_at)
values
  ('01920000-0000-7000-8000-0000000000b1', repeat('1', 64), repeat('1', 64), 'n1.00000000',
   '[]', '[]', '[]', now(), now() - interval '1 hour'),
  ('01920000-0000-7000-8000-0000000000b1', repeat('1', 64), repeat('2', 64), 'n1.00000000',
   '["wanted"]', '[{"reason": "wanted", "source": "title", "quote": "WANTED", "start": 0, "end": 6}]',
   '[{"term": "gaming pc", "key": null, "status": "generic"}]', now(), now()),
  ('01920000-0000-7000-8000-0000000000b2', repeat('2', 64), repeat('3', 64), 'n1.00000000',
   '[]', '[]', '[]', now(), now()),
  ('01920000-0000-7000-8000-0000000000b3', repeat('3', 64), repeat('4', 64), 'n1.00000000',
   '["service"]', '[]', '[]', now(), now());
select pg_temp.check((select count(*) from noise_filter.v_classifications) = 3,
  'v_classifications shows the latest row per version');
select pg_temp.check((select reasons from noise_filter.v_classifications
  where listing_id = '01920000-0000-7000-8000-0000000000b1') = '["wanted"]',
  'the latest row of a version wins');
-- The replay upsert moves classified_at only.
insert into noise_filter.classifications (listing_id, evidence_hash, input_hash, rule_version,
  classified_at)
values ('01920000-0000-7000-8000-0000000000b1', repeat('1', 64), repeat('1', 64), 'n1.00000000',
  now() + interval '1 hour')
on conflict (listing_id, evidence_hash, input_hash, rule_version)
  do update set classified_at = excluded.classified_at;
select pg_temp.check((select reasons from noise_filter.v_classifications
  where listing_id = '01920000-0000-7000-8000-0000000000b1') = '[]',
  'an earlier row made latest again is shown');
select pg_temp.check((select count(*) from noise_filter.classifications) = 4,
  'the upsert added no row');
reset role;

-- Unique key and checks.
do $$
begin
  begin
    insert into noise_filter.classifications (listing_id, evidence_hash, input_hash, rule_version,
      classified_at)
    values ('01920000-0000-7000-8000-0000000000b2', repeat('2', 64), repeat('3', 64),
      'n1.00000000', now());
    raise exception 'FAILED: a duplicate key was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into noise_filter.classifications (listing_id, evidence_hash, input_hash, rule_version,
      reasons, classified_at)
    values ('01920000-0000-7000-8000-0000000000b2', repeat('2', 64), repeat('9', 64),
      'n1.00000000', '["not_a_pc"]', now());
    raise exception 'FAILED: an unknown reason was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into noise_filter.classifications (listing_id, evidence_hash, input_hash, rule_version,
      classified_at)
    values ('01920000-0000-7000-8000-0000000000b2', repeat('2', 64), repeat('8', 64),
      'a1.00000000', now());
    raise exception 'FAILED: a foreign rule version was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into noise_filter.classifications (listing_id, evidence_hash, input_hash, rule_version,
      classified_at)
    values ('01920000-0000-7000-8000-0000000000b2', 'nothex', repeat('7', 64), 'n1.00000000', now());
    raise exception 'FAILED: a malformed evidence hash was accepted';
  exception when check_violation then null;
  end;
end;
$$;

-- Put listing 1's wanted row back on top for the user-facing checks.
update noise_filter.classifications set classified_at = now() + interval '2 hours'
where listing_id = '01920000-0000-7000-8000-0000000000b1' and input_hash = repeat('2', 64);

-- On: the user-facing view shows listing 1 (wanted), never the clean listing 2 or the suppressed
-- listing 3; a direct read of the table by nabvy_app sees no suppressed row.
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_noise_filter_reasons) = 1,
  'app.v_noise_filter_reasons shows only listings with reasons, never a suppressed one');
select pg_temp.check((select reasons from app.v_noise_filter_reasons
  where listing_id = '01920000-0000-7000-8000-0000000000b1') = '["wanted"]',
  'app.v_noise_filter_reasons shows the reason codes');
select pg_temp.check(not exists (select 1 from noise_filter.classifications
  where listing_id = '01920000-0000-7000-8000-0000000000b3'),
  'nabvy_app cannot see the suppressed listing in the table');
reset role;

-- Shadow: internal rows, no user-facing row, and the table hidden from nabvy_app.
update switches.switches set state = 'shadow' where name = 'noise-filter';
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_noise_filter_reasons) = 0,
  'shadow hides user-facing rows');
select pg_temp.check((select count(*) from noise_filter.classifications) = 0,
  'shadow hides the table from nabvy_app');
reset role;
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from noise_filter.v_classifications) = 3,
  'shadow shows internal rows');
reset role;

-- Off: both views empty.
update switches.switches set state = 'off' where name = 'noise-filter';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from noise_filter.v_classifications) = 0,
  'off empties v_classifications');
reset role;
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_noise_filter_reasons) = 0,
  'off empties the user-facing view');
reset role;

-- listing-suppression off: the user-facing view is empty even with this module on.
update switches.switches set state = 'on' where name = 'noise-filter';
update switches.switches set state = 'off' where name = 'listing-suppression';
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_noise_filter_reasons) = 0,
  'listing-suppression off empties the user-facing view');
reset role;

-- The foundation's view check finds nothing at all.
select pg_temp.check(not exists (select 1 from nabvy_core.view_violations()),
  'nabvy_core.view_violations() is empty');

rollback;
