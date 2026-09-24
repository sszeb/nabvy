-- listing-ingest module (packages/db/migrations/listing-ingest): who may write, the unique keys,
-- the switch on every view, v_price_changes and the privileges. Runs in one transaction that is
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

insert into switches.switches (name, kind, state) values ('listing-ingest', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- Only the pipeline role writes; nabvy_app, anon and authenticated cannot even use the schema.
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'listing_ingest.listings', 'insert'),
  'pipeline inserts listings');
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'listing_ingest.sightings', 'insert'),
  'pipeline inserts sightings');
select pg_temp.check(not has_schema_privilege(r, 'listing_ingest', 'usage'),
  r || ' has no usage on listing_ingest')
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r;
select pg_temp.check(not has_table_privilege(r, 'listing_ingest.' || v, 'select'),
  r || ' cannot read ' || v)
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r,
     unnest(array['v_listings', 'v_sightings', 'v_price_changes', 'v_city_pages_seen',
                  'v_fingerprints']) as v;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'listing_ingest.' || v, 'select'),
  'pipeline reads ' || v)
from unnest(array['v_listings', 'v_sightings', 'v_price_changes', 'v_city_pages_seen',
                  'v_fingerprints']) as v;

-- No user-facing views (rule 5).
select pg_temp.check(not exists (
  select 1 from information_schema.views
  where table_schema = 'app' and table_name like 'v\_listing\_ingest%'), 'no app views');

-- Every view is security_invoker.
select pg_temp.check(coalesce(c.reloptions @> array['security_invoker=true'], false),
  c.relname || ' is security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'listing_ingest' and c.relkind = 'v';

set local role nabvy_pipeline;
insert into listing_ingest.listings (source, source_listing_id, card_hash, price_minor, currency,
  money_kind, title, first_fetched_at, last_seen_at, availability, item_job_id, item_seq)
values ('facebook', '28242423458759790', repeat('a', 64), 20000, 'GBP', 'fixed', 'Gaming PC',
  '2026-09-24T01:40:43Z', '2026-09-24T01:40:43Z', 'live', 1, 0);
insert into listing_ingest.sightings (listing_id, job_id, seq, kind, terms, centre_ids, rank,
  card_hash, price_minor, currency, availability, seen_at)
select id, 1, 0, 'search', array['gaming pc'], array['115935195086622'], 1, repeat('a', 64), 20000, 'GBP',
  'live', '2026-09-24T01:40:43Z'
from listing_ingest.listings;
insert into listing_ingest.sightings (listing_id, job_id, seq, kind, card_hash, price_minor,
  currency, availability, seen_at)
select id, 2, 0, 'detail', repeat('b', 64), 18000, 'GBP', 'live', '2026-09-25T01:00:00Z'
from listing_ingest.listings;
reset role;

-- Unique keys: one identity per source listing ID; one observation per listing, job and kind.
do $$
begin
  begin
    insert into listing_ingest.listings (source, source_listing_id, card_hash, title,
      first_fetched_at, last_seen_at, availability, item_job_id, item_seq)
    values ('facebook', '28242423458759790', repeat('c', 64), 'x', now(), now(), 'live', 3, 0);
    raise exception 'NOT REFUSED: duplicate listing';
  exception when unique_violation then null;
  end;
  begin
    insert into listing_ingest.sightings (listing_id, job_id, seq, kind, card_hash, availability,
      seen_at)
    select id, 1, 5, 'search', repeat('c', 64), 'live', now() from listing_ingest.listings;
    raise exception 'NOT REFUSED: duplicate sighting';
  exception when unique_violation then null;
  end;
  begin
    insert into listing_ingest.listings (source, source_listing_id, card_hash, title, currency,
      first_fetched_at, last_seen_at, availability, item_job_id, item_seq)
    values ('facebook', '1', repeat('c', 64), 'x', 'USD', now(), now(), 'live', 3, 0);
    raise exception 'NOT REFUSED: USD price';
  exception when check_violation then null;
  end;
end;
$$;

set local role nabvy_pipeline;
select pg_temp.check((select count(*) from listing_ingest.v_listings) = 1, 'v_listings shows the row');
select pg_temp.check((select source_listing_id from listing_ingest.v_listings) = '28242423458759790',
  'the 17-digit ID is kept as text');
select pg_temp.check((select count(*) from listing_ingest.v_price_changes
  where previous_minor = 20000 and price_minor = 18000 and kind = 'detail') = 1,
  'v_price_changes shows the detail price drop');
select pg_temp.check((select count(*) from listing_ingest.v_fingerprints
  where fingerprint ~ '^[0-9a-f]{64}$') = 1, 'v_fingerprints hashes');
reset role;

-- Off: every view is empty.
update switches.switches set state = 'off' where name = 'listing-ingest';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from listing_ingest.v_listings) = 0
  and (select count(*) from listing_ingest.v_sightings) = 0
  and (select count(*) from listing_ingest.v_price_changes) = 0
  and (select count(*) from listing_ingest.v_city_pages_seen) = 0
  and (select count(*) from listing_ingest.v_fingerprints) = 0, 'views are empty while off');
reset role;

-- The foundation's view check passes for this schema.
select pg_temp.check(not exists (
  select 1 from nabvy_core.view_violations() v where v::text like '%listing_ingest%'),
  'no view violations in listing_ingest');

rollback;
