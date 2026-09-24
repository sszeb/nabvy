-- listing-suppression module (packages/db/migrations/listing-suppression): who may write, the
-- checks, the privileges of is_suppressed(), resolution and expiry, fail-closed reads, and a
-- user-facing view that leaves suppressed listings out and returns no rows while the module is
-- off (rule 11). Runs in one transaction that is rolled back, on a throwaway database only
-- (scripts/db-dry-run.sh).
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

insert into switches.switches (name, kind, state) values
  ('listing-suppression', 'module', 'on'), ('listing-ingest', 'module', 'on'),
  ('detail-evidence', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- Only the pipeline role reads and inserts; nobody updates or deletes; nabvy_app may only call
-- is_suppressed(); anon and authenticated get nothing.
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'listing_suppression.entries', p),
  'pipeline may ' || p)
from unnest(array['select', 'insert']) as p;
select pg_temp.check(not has_table_privilege(r, 'listing_suppression.entries', p),
  r || ' may not ' || p)
from unnest(array['nabvy_pipeline', 'nabvy_app']) as r,
     unnest(array['update', 'delete', 'truncate']) as p;
select pg_temp.check(not has_table_privilege(r, 'listing_suppression.' || o, 'select'),
  r || ' cannot read ' || o)
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r,
     unnest(array['entries', 'v_suppressed']) as o;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'listing_suppression.v_suppressed', 'select'),
  'pipeline reads v_suppressed');
select pg_temp.check(not has_schema_privilege(r, 'listing_suppression', 'usage'),
  r || ' has no usage on listing_suppression')
from unnest(array['anon', 'authenticated']) as r;
select pg_temp.check(has_function_privilege(r, 'listing_suppression.is_suppressed(uuid)', 'execute'),
  r || ' may call is_suppressed')
from unnest(array['nabvy_app', 'nabvy_pipeline']) as r;
select pg_temp.check(not has_function_privilege(r, 'listing_suppression.is_suppressed(uuid)', 'execute'),
  r || ' may not call is_suppressed')
from unnest(array['anon', 'authenticated']) as r;
select pg_temp.check(not has_function_privilege(r, 'listing_suppression.listing_hash(text, text)', 'execute'),
  r || ' may not call listing_hash')
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r;
select pg_temp.check(
  (select prosecdef from pg_proc where oid = 'listing_suppression.is_suppressed(uuid)'::regprocedure),
  'is_suppressed is SECURITY DEFINER');

-- Every view is security_invoker.
select pg_temp.check(coalesce(c.reloptions @> array['security_invoker=true'], false),
  c.relname || ' is security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'listing_suppression' and c.relkind = 'v';

-- Three listings: A is named; B is a relist of A (same title, price and city page); C is another.
insert into listing_ingest.listings (id, source, source_listing_id, card_hash, price_minor,
  currency, title, first_fetched_at, last_seen_at, city_page_id, availability, item_job_id, item_seq)
values
  ('01920000-0000-7000-8000-00000000000a', 'facebook', '1816901372840238', repeat('a', 64), 20000,
   'GBP', 'Gaming PC', now(), now(), '110843418940484', 'live', 1, 0),
  ('01920000-0000-7000-8000-00000000000b', 'facebook', '9000000000000001', repeat('b', 64), 20000,
   'GBP', 'Gaming  pc', now(), now(), '110843418940484', 'live', 2, 0),
  ('01920000-0000-7000-8000-00000000000c', 'facebook', '1756692548940192', repeat('c', 64), 30000,
   'GBP', 'Other PC', now(), now(), '110843418940484', 'live', 1, 1);

-- Checks: hashes only, look-alikes carry a basis and an expiry, other kinds carry neither.
do $$
begin
  begin
    insert into listing_suppression.entries (kind, value, request_id)
    values ('listing_hash', '1816901372840238', '01920000-0000-7000-8000-0000000000f1');
    raise exception 'NOT REFUSED: a raw listing ID';
  exception when check_violation then null;
  end;
  begin
    insert into listing_suppression.entries (kind, value, request_id)
    values ('lookalike', repeat('d', 64), '01920000-0000-7000-8000-0000000000f1');
    raise exception 'NOT REFUSED: a look-alike without expiry';
  exception when check_violation then null;
  end;
  begin
    insert into listing_suppression.entries (kind, basis, value, expires_at, request_id)
    values ('seller_key', 'card', repeat('d', 64), now(), '01920000-0000-7000-8000-0000000000f1');
    raise exception 'NOT REFUSED: an expiring seller key';
  exception when check_violation then null;
  end;
  begin
    insert into listing_suppression.entries (kind, value, request_id)
    values ('seller_name', repeat('d', 64), '01920000-0000-7000-8000-0000000000f1');
    raise exception 'NOT REFUSED: an unknown kind';
  exception when check_violation then null;
  end;
end;
$$;

-- A user-facing view of listings built as rule 5 requires (stands in for app.v_listing_card).
create schema if not exists app;
create view app.v_listing_card_probe with (security_invoker = true) as
select l.id as listing_id
from listing_ingest.listings l
where not listing_suppression.is_suppressed(l.id)
  and switches.is_on('listing-suppression');
grant usage on schema app, listing_ingest to nabvy_app;
grant select on listing_ingest.listings, app.v_listing_card_probe to nabvy_app;

-- Nothing on the list yet: nothing hidden.
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_listing_card_probe) = 3, 'empty list hides nothing');
reset role;

-- The request names A: its hash, and a card look-alike that expires in 90 days. A second
-- request's look-alike on C expired yesterday.
set local role nabvy_pipeline;
insert into listing_suppression.entries (kind, basis, value, expires_at, request_id)
select 'listing_hash', null::text, listing_suppression.listing_hash('facebook', '1816901372840238'),
  null::timestamptz, '01920000-0000-7000-8000-0000000000f1'::uuid
union all
select 'lookalike', 'card', f.fingerprint, now() + interval '90 days',
  '01920000-0000-7000-8000-0000000000f1'::uuid
from listing_ingest.v_fingerprints f where f.listing_id = '01920000-0000-7000-8000-00000000000a'
union all
select 'lookalike', 'card', f.fingerprint, now() - interval '1 day',
  '01920000-0000-7000-8000-0000000000f2'::uuid
from listing_ingest.v_fingerprints f where f.listing_id = '01920000-0000-7000-8000-00000000000c';
select pg_temp.check((select count(*) from listing_suppression.entries) = 3, 'three entries');
select pg_temp.check(
  (select array_agg(listing_id::text || ' ' || reason order by listing_id, reason)
   from listing_suppression.v_suppressed)
  = array['01920000-0000-7000-8000-00000000000a listing_hash',
          '01920000-0000-7000-8000-00000000000a lookalike',
          '01920000-0000-7000-8000-00000000000b lookalike'],
  'v_suppressed: A by hash and look-alike, B by look-alike, C not (expired)');
select pg_temp.check((select until from listing_suppression.v_suppressed
  where reason = 'listing_hash') is null, 'a named listing is hidden with no end');
select pg_temp.check((select until from listing_suppression.v_suppressed
  where listing_id = '01920000-0000-7000-8000-00000000000b')
  between now() + interval '89 days' and now() + interval '90 days', 'a look-alike ends in 90 days');
reset role;

set local role nabvy_app;
select pg_temp.check(
  (select array_agg(listing_id::text) from app.v_listing_card_probe)
  = array['01920000-0000-7000-8000-00000000000c'], 'a suppressed listing never reaches an app view');
select pg_temp.check(listing_suppression.is_suppressed(null), 'a null listing reads as suppressed');
reset role;

-- The switch filter does not apply to the list, and an off module hides every listing.
update switches.switches set state = 'off' where name = 'listing-suppression';
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_listing_card_probe) = 0,
  'listing-suppression off: the app view returns no rows');
select pg_temp.check(listing_suppression.is_suppressed('01920000-0000-7000-8000-00000000000a'),
  'is_suppressed still answers while off');
reset role;
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from listing_suppression.v_suppressed) = 3,
  'v_suppressed still answers while off');
reset role;
update switches.switches set state = 'shadow' where name = 'listing-suppression';
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_listing_card_probe) = 0,
  'listing-suppression shadow: the app view returns no rows');
reset role;
update switches.switches set state = 'on' where name = 'listing-suppression';

-- Fail closed: with listing-ingest off its views are empty, so every listing reads as suppressed.
update switches.switches set state = 'off' where name = 'listing-ingest';
set local role nabvy_app;
select pg_temp.check(listing_suppression.is_suppressed('01920000-0000-7000-8000-00000000000c'),
  'listing-ingest off: every listing reads as suppressed');
select pg_temp.check((select count(*) from app.v_listing_card_probe) = 0,
  'listing-ingest off: the app view returns no rows');
reset role;
update switches.switches set state = 'on' where name = 'listing-ingest';

-- Description look-alike: C's current description also appears on D, a new listing with another
-- title and price. A request names C; its description look-alike hides D too.
insert into listing_ingest.listings (id, source, source_listing_id, card_hash, price_minor,
  currency, title, first_fetched_at, last_seen_at, city_page_id, availability, item_job_id, item_seq)
values ('01920000-0000-7000-8000-00000000000d', 'facebook', '9000000000000002', repeat('d', 64),
  15000, 'GBP', 'Another title', now(), now(), '110843418940484', 'live', 3, 0);
insert into detail_evidence.evidence (source, source_listing_id, listing_id, evidence_hash,
  first_seen_at, last_seen_at, item_job_id, item_seq, title, description, description_status)
values
  ('facebook', '1756692548940192', '01920000-0000-7000-8000-00000000000c', repeat('c', 64), now(),
   now(), 1, 1, 'Other PC', 'Ryzen 5, RTX 3060', 'full_verified'),
  ('facebook', '9000000000000002', '01920000-0000-7000-8000-00000000000d', repeat('d', 64), now(),
   now(), 3, 0, 'Another title', 'ryzen 5,  RTX 3060', 'full_verified');
insert into detail_evidence.fetches (source, source_listing_id, listing_id, job_id, seq,
  fetched_at, detail_outcome, description_status, evidence_hash)
values
  ('facebook', '1756692548940192', '01920000-0000-7000-8000-00000000000c', 1, 1, now(),
   'collected', 'full_verified', repeat('c', 64)),
  ('facebook', '9000000000000002', '01920000-0000-7000-8000-00000000000d', 3, 0, now(),
   'collected', 'full_verified', repeat('d', 64));
set local role nabvy_pipeline;
insert into listing_suppression.entries (kind, basis, value, expires_at, request_id)
select 'lookalike', 'description', f.fingerprint, now() + interval '90 days',
  '01920000-0000-7000-8000-0000000000f3'::uuid
from detail_evidence.v_fingerprints f where f.listing_id = '01920000-0000-7000-8000-00000000000c';
select pg_temp.check((select count(*) from listing_suppression.entries where basis = 'description') = 1,
  'one description look-alike');
select pg_temp.check(
  (select array_agg(listing_id::text order by listing_id) from listing_suppression.v_suppressed
   where reason = 'lookalike')
  = array['01920000-0000-7000-8000-00000000000a', '01920000-0000-7000-8000-00000000000b',
          '01920000-0000-7000-8000-00000000000c', '01920000-0000-7000-8000-00000000000d'],
  'the description look-alike hides C and D');
reset role;
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_listing_card_probe) = 0,
  'every probe listing is now hidden');
reset role;

-- Fail closed: with detail-evidence off its views are empty, so while a description look-alike is
-- active every listing reads as suppressed, including one no entry matches.
insert into listing_ingest.listings (id, source, source_listing_id, card_hash, price_minor,
  currency, title, first_fetched_at, last_seen_at, city_page_id, availability, item_job_id, item_seq)
values ('01920000-0000-7000-8000-00000000000e', 'facebook', '9000000000000003', repeat('e', 64),
  5000, 'GBP', 'Unrelated', now(), now(), '110843418940484', 'live', 4, 0);
set local role nabvy_app;
select pg_temp.check(not listing_suppression.is_suppressed('01920000-0000-7000-8000-00000000000e'),
  'an unmatched listing is shown');
reset role;
update switches.switches set state = 'off' where name = 'detail-evidence';
set local role nabvy_app;
select pg_temp.check(listing_suppression.is_suppressed('01920000-0000-7000-8000-00000000000e'),
  'detail-evidence off: every listing reads as suppressed');
reset role;
update switches.switches set state = 'on' where name = 'detail-evidence';

-- The foundation's view check passes for this schema.
select pg_temp.check(not exists (
  select 1 from nabvy_core.view_violations() v where v::text like '%listing_suppression%'),
  'no view violations in listing_suppression');

rollback;
