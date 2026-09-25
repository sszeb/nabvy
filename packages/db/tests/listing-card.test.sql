-- listing-card module (packages/db/migrations/listing-card): the exact column list of
-- app.v_listing_card, title redaction, the suppression and unresolved-status filters, the
-- stale-fallback flag, the switch states (rule 11) and who may read the view. Runs in one
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

insert into switches.switches (name, kind, state) values
  ('listing-card', 'module', 'on'), ('listing-suppression', 'module', 'on'),
  ('listing-ingest', 'module', 'on'), ('detail-evidence', 'module', 'on'),
  ('listing-lifecycle', 'module', 'on'), ('quote-redaction', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- app.v_listing_card is a plain view (README, "Decisions"); the row-building query lives in
-- app.listing_card(), security definer, search_path pinned, revoked from public.
select pg_temp.check(not coalesce(c.reloptions @> array['security_invoker=true'], false),
  'app.v_listing_card is a plain view, not security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'app' and c.relname = 'v_listing_card';
select pg_temp.check(
  (select prosecdef from pg_proc where oid = 'app.listing_card()'::regprocedure),
  'app.listing_card() is SECURITY DEFINER');
select pg_temp.check(
  exists (
    select 1 from unnest((select proconfig from pg_proc where oid = 'app.listing_card()'::regprocedure)) as c
    where c like 'search_path=%'
  ), 'app.listing_card() pins search_path');
select pg_temp.check(has_function_privilege(r, 'app.listing_card()', 'execute'),
  r || ' may call app.listing_card()')
from unnest(array['nabvy_app', 'nabvy_pipeline']) as r;
select pg_temp.check(not has_function_privilege(r, 'app.listing_card()', 'execute'),
  r || ' may not call app.listing_card()')
from unnest(array['anon', 'authenticated']) as r;
-- Reading it grants nabvy_app nothing new on the modules it joins: their own db tests each assert
-- nabvy_app has no schema usage at all, and this module's migration must not break that.
select pg_temp.check(not has_schema_privilege('nabvy_app', s, 'usage'),
  'nabvy_app still has no usage on ' || s)
from unnest(array['listing_ingest', 'detail_evidence', 'listing_lifecycle']) as s;
select pg_temp.check(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
   where table_schema = 'app' and table_name = 'v_listing_card')
  = array['listing_id', 'link', 'title', 'price_minor', 'currency', 'listed_at', 'town_label',
          'condition', 'availability', 'description_status', 'possibly_outdated'],
  'app.v_listing_card has exactly the module card''s columns');
select pg_temp.check(not exists (
  select 1 from information_schema.columns
  where table_schema = 'app' and table_name = 'v_listing_card'
    and column_name::text ~* '(seller|profile_(url|link|pic|picture|image)|^raw$|^raw_|_raw$|source_fields|lat|lng|photo)'),
  'no seller, coordinate or photo column');

-- Five listings: A has a phone number in its title and no detail fetch yet; B is named by
-- suppression; C has a full detail fetch, including a stale fallback; D's status is unresolved;
-- E is not a Facebook listing.
insert into listing_ingest.listings (id, source, source_listing_id, card_hash, price_minor,
  currency, title, first_fetched_at, last_seen_at, town_label, availability, item_job_id, item_seq)
values
  ('01920000-0000-7000-8000-00000000000a', 'facebook', '1000000000000001', repeat('a', 64), 20000,
   'GBP', 'Gaming PC call 07911 123456', now(), now(), 'Chichester', 'live', 1, 0),
  ('01920000-0000-7000-8000-00000000000b', 'facebook', '1000000000000002', repeat('b', 64), 15000,
   'GBP', 'Office chair', now(), now(), 'Chichester', 'live', 1, 1),
  ('01920000-0000-7000-8000-00000000000c', 'facebook', '1000000000000003', repeat('c', 64), 30000,
   'GBP', 'Sofa', now(), now(), 'Chichester', 'live', 1, 2),
  ('01920000-0000-7000-8000-00000000000d', 'facebook', '1000000000000004', repeat('d', 64), 5000,
   'GBP', 'Bike', now(), now(), 'Chichester', 'live', 1, 3),
  ('01920000-0000-7000-8000-00000000000e', 'ebay', '1000000000000005', repeat('e', 64), 8000,
   'GBP', 'Desk', now(), now(), 'Chichester', 'live', 1, 4);

insert into detail_evidence.evidence (source, source_listing_id, listing_id, evidence_hash,
  first_seen_at, last_seen_at, item_job_id, item_seq, title, description_status, condition,
  stale_fallback)
values ('facebook', '1000000000000003', '01920000-0000-7000-8000-00000000000c', repeat('c', 64),
  now(), now(), 1, 0, 'Sofa', 'full_verified', 'used_good', true);
insert into detail_evidence.fetches (source, source_listing_id, listing_id, job_id, seq,
  fetched_at, detail_outcome, description_status, stale_fallback, evidence_hash)
values ('facebook', '1000000000000003', '01920000-0000-7000-8000-00000000000c', 1, 0, now(),
  'collected', 'full_verified', true, repeat('c', 64));

insert into listing_lifecycle.status (listing_id, source, source_listing_id, status, basis,
  input_hash, changed_by)
values ('01920000-0000-7000-8000-00000000000d', 'facebook', '1000000000000004', 'unresolved',
  'unresolved-fetch', repeat('1', 64), 'listing-lifecycle');

insert into listing_suppression.entries (kind, value, request_id)
values ('listing_hash', listing_suppression.listing_hash('facebook', '1000000000000002'),
  '01920000-0000-7000-8000-0000000000f1');

set local role nabvy_app;

-- A, C and E show; B is suppressed and D is unresolved.
select pg_temp.check(
  (select array_agg(listing_id::text order by listing_id) from app.v_listing_card)
  = array['01920000-0000-7000-8000-00000000000a', '01920000-0000-7000-8000-00000000000c',
          '01920000-0000-7000-8000-00000000000e'],
  'A, C and E show; a suppressed listing and an unresolved one never do');

-- A's title is redacted like any quote (module card, "redact()... like any quote").
select pg_temp.check(
  (select title from app.v_listing_card where listing_id = '01920000-0000-7000-8000-00000000000a')
  = 'Gaming PC call [phone redacted]', 'a phone number in the title is masked');

-- C carries its detail fields and the stale-fallback flag; A has no detail fetch yet, so both read
-- null/false, never an error.
select pg_temp.check(
  (select condition = 'used_good' and description_status = 'full_verified'
     and possibly_outdated = true
   from app.v_listing_card where listing_id = '01920000-0000-7000-8000-00000000000c'),
  'C carries its detail fields and possibly_outdated');
select pg_temp.check(
  (select condition is null and description_status is null and possibly_outdated = false
   from app.v_listing_card where listing_id = '01920000-0000-7000-8000-00000000000a'),
  'A has no detail fetch yet: null fields and possibly_outdated false');

-- The link is Facebook's item URL, and null for a listing that is not a Facebook one.
select pg_temp.check(
  (select link from app.v_listing_card where listing_id = '01920000-0000-7000-8000-00000000000a')
  = 'https://www.facebook.com/marketplace/item/1000000000000001/', 'the Facebook item link');
select pg_temp.check(
  (select link from app.v_listing_card where listing_id = '01920000-0000-7000-8000-00000000000e')
  is null, 'a non-Facebook listing has no Facebook link');

reset role;

-- Switch states (rule 11): off and shadow both hide every row from the user-facing view.
update switches.switches set state = 'off' where name = 'listing-card';
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_listing_card) = 0, 'listing-card off: no rows');
reset role;
update switches.switches set state = 'shadow' where name = 'listing-card';
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_listing_card) = 0, 'listing-card shadow: no rows');
reset role;
update switches.switches set state = 'on' where name = 'listing-card';

-- Fail closed: an off or unreachable listing-suppression hides every listing (rule 11), not only
-- the ones it names.
update switches.switches set state = 'off' where name = 'listing-suppression';
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_listing_card) = 0,
  'listing-suppression off: the card view returns no rows');
reset role;
update switches.switches set state = 'on' where name = 'listing-suppression';

-- listing-ingest off empties its own view, and listing-card carries nothing on top of that.
update switches.switches set state = 'off' where name = 'listing-ingest';
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_listing_card) = 0,
  'listing-ingest off: the card view returns no rows');
reset role;
update switches.switches set state = 'on' where name = 'listing-ingest';

-- Who may read: nabvy_app and nabvy_pipeline only.
select pg_temp.check(has_table_privilege(r, 'app.v_listing_card', 'select'), r || ' may read the card')
from unnest(array['nabvy_app', 'nabvy_pipeline']) as r;
select pg_temp.check(not has_table_privilege(r, 'app.v_listing_card', 'select'),
  r || ' may not read the card')
from unnest(array['anon', 'authenticated']) as r;

rollback;
