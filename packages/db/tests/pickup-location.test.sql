-- pickup-location module (packages/db/migrations/pickup-location): who may write, the unique
-- keys and checks, the switch on every view, the user-facing view's exact columns, its
-- suppression anti-join and its row-level guard, and the privileges. Runs in one transaction
-- that is rolled back, on a throwaway database only (scripts/db-dry-run.sh).
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
values ('pickup-location', 'module', 'on'), ('listing-suppression', 'module', 'on'),
       ('listing-ingest', 'module', 'on'), ('detail-evidence', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- Only the pipeline role writes; anon and authenticated cannot use the schema; nabvy_app has no
-- select on any table beyond the columns the user-facing view shows, and none on candidates,
-- mentions or the field point.
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'pickup_location.' || t, 'insert'),
  'pipeline inserts ' || t)
from unnest(array['resolutions', 'candidates', 'mentions', 'current', 'handover', 'overrides',
  'ai_queue']) as t;
select pg_temp.check(not has_schema_privilege(r, 'pickup_location', 'usage'),
  r || ' has no usage on pickup_location')
from unnest(array['anon', 'authenticated']) as r;
select pg_temp.check(not has_table_privilege('nabvy_app', 'pickup_location.' || t, 'select'),
  'nabvy_app cannot read ' || t)
from unnest(array['resolutions', 'candidates', 'mentions', 'overrides', 'ai_queue']) as t;
select pg_temp.check(not has_any_column_privilege('nabvy_app', 'pickup_location.' || t, 'insert')
  and not has_any_column_privilege('nabvy_app', 'pickup_location.' || t, 'update'),
  'nabvy_app cannot write ' || t)
from unnest(array['current', 'handover']) as t;
select pg_temp.check(not has_column_privilege('nabvy_app', 'pickup_location.current', c, 'select'),
  'nabvy_app cannot read current.' || c)
from unnest(array['resolution_id', 'decided_by', 'conflict', 'pass', 'evidence_hash']) as c;
select pg_temp.check(not has_column_privilege('nabvy_app', 'pickup_location.handover', c, 'select'),
  'nabvy_app cannot read handover.' || c)
from unnest(array['postage_only_text', 'courier_only_text', 'delivery_only_text']) as c;
select pg_temp.check(not has_table_privilege(r, 'pickup_location.' || v, 'select'),
  r || ' cannot read ' || v)
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r,
     unnest(array['v_areas', 'v_evidence', 'v_handover', 'v_ai_usage']) as v;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'pickup_location.' || v, 'select'),
  'pipeline reads ' || v)
from unnest(array['v_areas', 'v_evidence', 'v_handover', 'v_ai_usage']) as v;

-- The user-facing view: granted to nabvy_app and to no other application role (rule 5), with
-- exactly the allowed columns and nothing finer than a district or a display point.
select pg_temp.check(has_table_privilege('nabvy_app', 'app.v_pickup_location', 'select'),
  'nabvy_app reads app.v_pickup_location');
select pg_temp.check(not has_table_privilege(r, 'app.v_pickup_location', 'select'),
  r || ' cannot read app.v_pickup_location')
from unnest(array['nabvy_pipeline', 'anon', 'authenticated']) as r;
select pg_temp.check(not has_schema_privilege(r, 'app', 'usage'), r || ' has no usage on app')
from unnest(array['anon', 'authenticated']) as r;
select pg_temp.check((
  select array_agg(column_name::text order by ordinal_position)
  from information_schema.columns
  where table_schema = 'app' and table_name = 'v_pickup_location')
  = array['listing_id', 'town_or_area', 'approximate', 'area_id', 'area_district',
    'area_landmass', 'status', 'source', 'note_code', 'note_place_label', 'listed_in_label',
    'lat', 'lng', 'uncertainty_km', 'collection', 'meetup_offered', 'local_delivery', 'postage'],
  'app.v_pickup_location has exactly the allowed columns');

-- Every view is security_invoker.
select pg_temp.check(coalesce(c.reloptions @> array['security_invoker=true'], false),
  n.nspname || '.' || c.relname || ' is security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('pickup_location', 'app') and c.relkind = 'v';

-- Two listings known to listing-ingest, one of them suppressed.
insert into listing_ingest.listings (id, source, source_listing_id, card_hash, price_minor,
  currency, title, first_fetched_at, last_seen_at, city_page_id, availability, item_job_id, item_seq)
values
  ('01920000-0000-7000-8000-0000000000a1', 'facebook', 'pl-1', repeat('a', 64), 20000, 'GBP',
   'RTX 3090', now(), now(), '115935195086622', 'live', 1, 0),
  ('01920000-0000-7000-8000-0000000000a2', 'facebook', 'pl-2', repeat('b', 64), 15000, 'GBP',
   'RTX 3080', now(), now(), '115935195086622', 'live', 1, 1);
insert into listing_suppression.entries (kind, value, request_id)
values ('listing_hash', listing_suppression.listing_hash('facebook', 'pl-2'),
  '00000000-0000-7000-8000-000000000042');

-- One resolution per listing, with a candidate holding a full postcode, and a mention.
set local role nabvy_pipeline;
insert into pickup_location.resolutions (id, listing_id, pass, evidence_hash, rule_version,
  status, basis, source, confidence, conflict, approximate, town_or_area, area_id, area_district,
  lat, lng, note_code, note_place_label, listed_in_label, field_label, field_lat, field_lng)
values
  ('01920000-0000-7000-8000-000000000101', '01920000-0000-7000-8000-0000000000a1', 'detail', repeat('a', 64), 'r1.25d64b70',
   'from_description', 'text', 'description', 'medium', true, true, 'Bognor Regis',
   'cp:108540552503171', 'PO21', 50.798, -0.6207, 'description_says_collection_from',
   'Bognor Regis', 'Chichester', 'Chichester', 50.8365, -0.7792),
  ('01920000-0000-7000-8000-000000000102', '01920000-0000-7000-8000-0000000000a2', 'detail', repeat('b', 64), 'r1.25d64b70',
   'field_only', 'field', 'listing', 'high', false, false, 'Chichester', 'cp:115935195086622',
   null, 50.8365, -0.7792, null, null, null, 'Chichester', 50.8365, -0.7792);
insert into pickup_location.candidates (resolution_id, listing_id, seq, kind, value, label,
  area_id, lat, lng, role, cue, strength)
values ('01920000-0000-7000-8000-000000000101', '01920000-0000-7000-8000-0000000000a1', 0, 'postcode_full', 'PO21 1AA', 'PO21',
  'cp:108540552503171', 50.798, -0.6207, 'pickup', 'Collection from', 'strong');
insert into pickup_location.mentions (resolution_id, listing_id, seq, candidate_seq, source,
  quote_start, quote_end, quote_redacted, role, cue, strength)
values ('01920000-0000-7000-8000-000000000101', '01920000-0000-7000-8000-0000000000a1', 0, 0, 'description', 16, 24,
  'Collection from PO21 ***', 'pickup', 'Collection from', 'strong');
insert into pickup_location.current (listing_id, resolution_id, pass, evidence_hash, status,
  basis, source, conflict, approximate, town_or_area, area_id, area_district, lat, lng,
  note_code, note_place_label, listed_in_label)
values
  ('01920000-0000-7000-8000-0000000000a1', '01920000-0000-7000-8000-000000000101', 'detail', repeat('a', 64),
   'from_description', 'text', 'description', true, true, 'Bognor Regis', 'cp:108540552503171',
   'PO21', 50.798, -0.6207, 'description_says_collection_from', 'Bognor Regis', 'Chichester'),
  ('01920000-0000-7000-8000-0000000000a2', '01920000-0000-7000-8000-000000000102', 'detail', repeat('b', 64), 'field_only',
   'field', 'listing', false, false, 'Chichester', 'cp:115935195086622', null, 50.8365, -0.7792,
   null, null, null);
insert into pickup_location.handover (listing_id, evidence_hash, collection, postage,
  postage_only_text)
values ('01920000-0000-7000-8000-0000000000a1', repeat('a', 64), 'yes', 'text', true);
insert into pickup_location.ai_queue (listing_id, evidence_hash, reason)
values ('01920000-0000-7000-8000-0000000000a1', repeat('a', 64), 'uncertain');
reset role;

-- Unique keys and checks: one resolution per listing, pass, hash and version; known statuses,
-- bases and passes; a district is a whole outward code; an area has a point and vice versa.
do $$
begin
  begin
    insert into pickup_location.resolutions (listing_id, pass, evidence_hash, rule_version,
      status, basis, source, confidence)
    values ('01920000-0000-7000-8000-0000000000a1', 'detail', repeat('a', 64), 'r1.25d64b70', 'unknown', 'fallback', 'none',
      'none');
    raise exception 'NOT REFUSED: duplicate resolution';
  exception when unique_violation then null;
  end;
  begin
    insert into pickup_location.resolutions (listing_id, pass, evidence_hash, rule_version,
      status, basis, source, confidence)
    values ('01920000-0000-7000-8000-0000000000a1', 'photo', repeat('c', 64), 'r1.25d64b70', 'unknown', 'fallback', 'none',
      'none');
    raise exception 'NOT REFUSED: unknown pass';
  exception when check_violation then null;
  end;
  begin
    insert into pickup_location.resolutions (listing_id, pass, evidence_hash, rule_version,
      status, basis, source, confidence, area_district)
    values ('01920000-0000-7000-8000-0000000000a1', 'detail', repeat('c', 64), 'r1.25d64b70', 'unknown', 'fallback', 'none',
      'none', 'PO21 1AA');
    raise exception 'NOT REFUSED: a full postcode as the district';
  exception when check_violation then null;
  end;
  begin
    insert into pickup_location.resolutions (listing_id, pass, evidence_hash, rule_version,
      status, basis, source, confidence, town_or_area, area_id)
    values ('01920000-0000-7000-8000-0000000000a1', 'detail', repeat('c', 64), 'r1.25d64b70', 'field_only', 'field', 'listing',
      'high', 'Chichester', 'cp:1');
    raise exception 'NOT REFUSED: an area without a point';
  exception when check_violation then null;
  end;
  begin
    insert into pickup_location.resolutions (listing_id, pass, evidence_hash, rule_version,
      status, basis, source, confidence)
    values ('01920000-0000-7000-8000-0000000000a1', 'detail', repeat('c', 64), 'v1', 'unknown', 'fallback', 'none', 'none');
    raise exception 'NOT REFUSED: malformed rule version';
  exception when check_violation then null;
  end;
  begin
    insert into pickup_location.ai_queue (listing_id, evidence_hash, reason)
    values ('01920000-0000-7000-8000-0000000000a1', repeat('a', 64), 'delivers_elsewhere');
    raise exception 'NOT REFUSED: duplicate queue row';
  exception when unique_violation then null;
  end;
end;
$$;

-- Internal views show the rows; the evidence view shows the district and the redacted quote,
-- never the full postcode or the field point.
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from pickup_location.v_areas) = 2, 'v_areas shows rows');
select pg_temp.check((select label from pickup_location.v_evidence where kind = 'candidate') = 'PO21',
  'v_evidence shows the district for a postcode candidate');
select pg_temp.check((select quote from pickup_location.v_evidence where kind = 'mention')
  = 'Collection from PO21 ***', 'v_evidence shows the redacted quote');
select pg_temp.check(not exists (
  select 1 from information_schema.columns
  where table_schema = 'pickup_location' and table_name like 'v\_%'
    and column_name in ('value', 'field_lat', 'field_lng', 'quote_start_raw')),
  'no internal view carries the raw value or the field point');
select pg_temp.check((select postage_only_text from pickup_location.v_handover) = true,
  'v_handover shows the flags');
select pg_temp.check((select count(*) from pickup_location.v_ai_usage) = 1, 'v_ai_usage shows the queue');
reset role;

-- The user-facing view: the shown listing only (the suppressed one is left out), with its
-- handover columns; a direct read of the tables by nabvy_app sees the same rows.
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_pickup_location) = 1,
  'app.v_pickup_location leaves out the suppressed listing');
select pg_temp.check((select area_district || ':' || collection || ':' || postage
  from app.v_pickup_location) = 'PO21:yes:text', 'app.v_pickup_location shows district and handover');
select pg_temp.check((select count(*) from pickup_location.current) = 1,
  'nabvy_app sees only the view''s rows in current');
select pg_temp.check((select count(*) from pickup_location.handover) = 1,
  'nabvy_app sees only the view''s rows in handover');
reset role;

-- Shadow hides the user-facing rows and keeps the internal ones; off empties every view; with
-- listing-suppression off the user-facing view is empty (rule 11).
update switches.switches set state = 'shadow' where name = 'pickup-location';
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_pickup_location) = 0, 'shadow hides user-facing rows');
select pg_temp.check((select count(*) from pickup_location.current) = 0, 'shadow hides the table from nabvy_app');
reset role;
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from pickup_location.v_areas) = 2, 'shadow shows internal rows');
reset role;
update switches.switches set state = 'off' where name = 'pickup-location';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from pickup_location.v_areas) = 0
  and (select count(*) from pickup_location.v_evidence) = 0
  and (select count(*) from pickup_location.v_handover) = 0
  and (select count(*) from pickup_location.v_ai_usage) = 0, 'views are empty while off');
reset role;
update switches.switches set state = 'on' where name = 'pickup-location';
update switches.switches set state = 'off' where name = 'listing-suppression';
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_pickup_location) = 0,
  'listing-suppression off empties the user-facing view');
reset role;

-- The foundation's view check finds nothing in this schema.
select pg_temp.check(not exists (
  select 1 from nabvy_core.view_violations() v where v::text like '%pickup_location%'),
  'no view violations in pickup_location');

rollback;
