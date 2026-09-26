-- price-drop-watch module (packages/db/migrations/price-drop-watch): who may write, the checks,
-- RLS isolation on watches, the user-facing views (columns, security_invoker, the switch and
-- suppression gates) and the listing_price_history() helper's privileges. Runs in one transaction
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

insert into switches.switches (name, kind, state) values
  ('price-drop-watch', 'module', 'on'), ('listing-ingest', 'module', 'on'),
  ('listing-suppression', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- Privileges: nabvy_app owns the watch (no delete: unwatch only deactivates); nabvy_pipeline
-- reads and removes (erase, account.deleted) but never creates or edits one. drops is pipeline
-- only. Nobody outside these two roles reaches the schema at all.
select pg_temp.check(has_table_privilege('nabvy_app', 'price_drop_watch.watches', p),
  'nabvy_app may ' || p || ' watches')
from unnest(array['select', 'insert', 'update']) as p;
select pg_temp.check(not has_table_privilege('nabvy_app', 'price_drop_watch.watches', 'delete'),
  'nabvy_app cannot delete a watch directly');
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'price_drop_watch.watches', p),
  'nabvy_pipeline may ' || p || ' watches')
from unnest(array['select', 'delete']) as p;
select pg_temp.check(not has_table_privilege('nabvy_pipeline', 'price_drop_watch.watches', p),
  'nabvy_pipeline may not ' || p || ' watches')
from unnest(array['insert', 'update']) as p;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'price_drop_watch.drops', p),
  'nabvy_pipeline may ' || p || ' drops')
from unnest(array['select', 'insert', 'delete']) as p;
select pg_temp.check(not has_table_privilege('nabvy_app', 'price_drop_watch.drops', p),
  'nabvy_app cannot reach drops directly')
from unnest(array['select', 'insert', 'update', 'delete']) as p;
select pg_temp.check(not has_schema_privilege(r, 'price_drop_watch', 'usage'),
  r || ' has no usage on price_drop_watch')
from unnest(array['anon', 'authenticated']) as r;
select pg_temp.check(not has_schema_privilege(r, 'app', 'usage'),
  r || ' has no usage on app')
from unnest(array['anon', 'authenticated']) as r;

-- The app views: nabvy_app only, an explicit column list, security_invoker (not caught by
-- nabvy_core.view_violations(), which scans only schemas the migration ledger knows — the `app`
-- schema is not itself a module, so this module's own SQL test carries the check).
select pg_temp.check(has_table_privilege('nabvy_app', 'app.' || v, 'select'),
  'nabvy_app reads app.' || v)
from unnest(array['v_price_drop_watch_watches', 'v_price_drop_watch_history']) as v;
select pg_temp.check(not has_table_privilege(r, 'app.' || v, 'select'),
  r || ' cannot read app.' || v)
from unnest(array['nabvy_pipeline', 'anon', 'authenticated']) as r,
     unnest(array['v_price_drop_watch_watches', 'v_price_drop_watch_history']) as v;
select pg_temp.check(coalesce(c.reloptions @> array['security_invoker=true'], false),
  'app.' || c.relname || ' is security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'app' and c.relname like 'v\_price\_drop\_watch%';
select pg_temp.check((
  select array_agg(column_name::text order by ordinal_position) from information_schema.columns
  where table_schema = 'app' and table_name = 'v_price_drop_watch_watches')
  = array['id', 'listing_id', 'active', 'created_at'], 'v_price_drop_watch_watches columns');
select pg_temp.check((
  select array_agg(column_name::text order by ordinal_position) from information_schema.columns
  where table_schema = 'app' and table_name = 'v_price_drop_watch_history')
  = array['listing_id', 'observed_at', 'price_minor', 'currency'], 'v_price_drop_watch_history columns');

-- This module's views are the user-facing surface: nabvy_app has select, the pipeline never does
-- (docs/security.md, "Cross-module reads behind a user-facing view"). Object-level permissions
-- checked below at lines 55–58; schema-level usage is shared across app modules.

-- listing_price_history(): SECURITY DEFINER, stable, pinned search_path, callable by nabvy_app
-- only (row-returning, so the pipeline gets no execute; it reads listing-ingest's views itself).
select pg_temp.check(
  (select prosecdef and provolatile = 's' and proconfig @> array['search_path=""']
   from pg_proc where oid = 'price_drop_watch.listing_price_history(uuid)'::regprocedure),
  'listing_price_history is SECURITY DEFINER, stable, with a pinned search_path');
select pg_temp.check(has_function_privilege('nabvy_app', 'price_drop_watch.listing_price_history(uuid)', 'execute'),
  'nabvy_app may call listing_price_history');
select pg_temp.check(not has_function_privilege(r, 'price_drop_watch.listing_price_history(uuid)', 'execute'),
  r || ' may not call listing_price_history')
from unnest(array['nabvy_pipeline', 'anon', 'authenticated']) as r;

-- listing_known(): the same pattern, for watch()'s own existence check (nabvy_app has no grant on
-- listing_ingest.v_listings). An unscoped boolean over one opaque ID; nabvy_app only, since no
-- pipeline code calls it.
select pg_temp.check(
  (select prosecdef and provolatile = 's' and proconfig @> array['search_path=""']
   from pg_proc where oid = 'price_drop_watch.listing_known(uuid)'::regprocedure),
  'listing_known is SECURITY DEFINER, stable, with a pinned search_path');
select pg_temp.check(has_function_privilege('nabvy_app', 'price_drop_watch.listing_known(uuid)', 'execute'),
  'nabvy_app may call listing_known');
select pg_temp.check(not has_function_privilege(r, 'price_drop_watch.listing_known(uuid)', 'execute'),
  r || ' may not call listing_known')
from unnest(array['nabvy_pipeline', 'anon', 'authenticated']) as r;

-- Two watched listings: A has two sightings (a drop, 20000 -> 15000 GBP) so v_price_changes shows
-- one row; B has one sighting only, no change. C is a third, unwatched listing.
insert into listing_ingest.listings (id, source, source_listing_id, card_hash, price_minor,
  currency, title, first_fetched_at, last_seen_at, city_page_id, availability, item_job_id, item_seq)
values
  ('01920000-0000-7000-8000-00000000000a', 'facebook', '1816901372840238', repeat('a', 64), 20000,
   'GBP', 'Gaming PC', now() - interval '2 days', now(), '110843418940484', 'live', 1, 0),
  ('01920000-0000-7000-8000-00000000000b', 'facebook', '9000000000000001', repeat('b', 64), 30000,
   'GBP', 'Other PC', now() - interval '2 days', now(), '110843418940484', 'live', 2, 0);
insert into listing_ingest.sightings (listing_id, job_id, seq, kind, card_hash, price_minor,
  currency, availability, seen_at)
values
  ('01920000-0000-7000-8000-00000000000a', 1, 0, 'search', repeat('a', 64), 20000, 'GBP', 'live',
   now() - interval '2 days'),
  ('01920000-0000-7000-8000-00000000000a', 2, 0, 'search', repeat('c', 64), 15000, 'GBP', 'live',
   now() - interval '1 day'),
  ('01920000-0000-7000-8000-00000000000b', 3, 0, 'search', repeat('b', 64), 30000, 'GBP', 'live',
   now() - interval '2 days');

-- RLS isolation: user b1 watches listing A; user b2 cannot see or edit it.
set local role nabvy_app;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000b1', true);
insert into price_drop_watch.watches (user_id, listing_id) values
  ('00000000-0000-4000-8000-0000000000b1', '01920000-0000-7000-8000-00000000000a');
do $$
begin
  if (select count(*) from price_drop_watch.watches) <> 1 then
    raise exception 'nabvy_app sees a watch it should not';
  end if;
  update price_drop_watch.watches set active = false
    where listing_id = '01920000-0000-7000-8000-00000000000a';
  if not found then
    raise exception 'nabvy_app cannot update its own watch';
  end if;
  update price_drop_watch.watches set active = true
    where listing_id = '01920000-0000-7000-8000-00000000000a';
end;
$$;
reset role;
set local role nabvy_app;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000b2', true);
do $$
begin
  if exists (select 1 from price_drop_watch.watches) then
    raise exception 'nabvy_app (b2) sees another user''s watch';
  end if;
  begin
    insert into price_drop_watch.watches (user_id, listing_id)
    values ('00000000-0000-4000-8000-0000000000b1', '01920000-0000-7000-8000-00000000000b');
    raise exception 'NOT REFUSED: nabvy_app wrote another user''s watch (WITH CHECK)';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Keys and checks: one watch per user and listing; a drop must be strictly lower, same currency,
-- non-negative, and its card_hash is a real sha256.
set local role nabvy_pipeline;
do $$
declare
  wid uuid;
begin
  begin
    insert into price_drop_watch.watches (user_id, listing_id)
    values ('00000000-0000-4000-8000-0000000000b1', '01920000-0000-7000-8000-00000000000a');
    raise exception 'NOT REFUSED: nabvy_pipeline created a watch (insert not granted)';
  exception when insufficient_privilege then null;
  end;
  select id into wid from price_drop_watch.watches
    where listing_id = '01920000-0000-7000-8000-00000000000a';
  begin
    insert into price_drop_watch.drops (watch_id, from_minor, to_minor, currency, observed_at,
      card_hash) values (wid, 15000, 20000, 'GBP', now(), repeat('a', 64));
    raise exception 'NOT REFUSED: to_minor not lower than from_minor';
  exception when check_violation then null;
  end;
  begin
    insert into price_drop_watch.drops (watch_id, from_minor, to_minor, currency, observed_at,
      card_hash) values (wid, 20000, 15000, 'GBP', now(), 'not-a-hash');
    raise exception 'NOT REFUSED: card_hash is not a sha256';
  exception when check_violation then null;
  end;
  insert into price_drop_watch.drops (watch_id, from_minor, to_minor, currency, observed_at,
    card_hash) values (wid, 20000, 15000, 'GBP', now() - interval '1 day', repeat('c', 64));
  begin
    insert into price_drop_watch.drops (watch_id, from_minor, to_minor, currency, observed_at,
      card_hash) values (wid, 20000, 15000, 'GBP', now(), repeat('c', 64));
    raise exception 'NOT REFUSED: duplicate (watch_id, card_hash)';
  exception when unique_violation then null;
  end;
end;
$$;
reset role;

-- The history and watches views, as the watching user: one anchor (first fetched price) plus one
-- change (the drop), never listing B (not watched).
set local role nabvy_app;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000b1', true);
do $$
begin
  if (select count(*) from app.v_price_drop_watch_watches) <> 1 then
    raise exception 'v_price_drop_watch_watches: expected one row';
  end if;
  if (select count(*) from app.v_price_drop_watch_history) <> 2 then
    raise exception 'v_price_drop_watch_history: expected an anchor and one change';
  end if;
  if exists (select 1 from app.v_price_drop_watch_history
             where listing_id <> '01920000-0000-7000-8000-00000000000a') then
    raise exception 'v_price_drop_watch_history: leaked another listing ID';
  end if;
  if (select price_minor from app.v_price_drop_watch_history order by observed_at desc limit 1)
     <> 15000 then
    raise exception 'v_price_drop_watch_history: latest price is wrong';
  end if;
end;
$$;
reset role;

-- listing_price_history() is scoped in its own body, not by RLS (its owner bypasses RLS): rows
-- only for the caller's own active watch. Called directly as nabvy_app: the watcher (b1) sees
-- listing A's two rows; another user (b2) sees nothing for A; nobody sees unwatched B; a call
-- with no app.user_id at all (outside withUser) returns nothing.
set local role nabvy_app;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000b1', true);
select pg_temp.check((select count(*) from price_drop_watch.listing_price_history(
  '01920000-0000-7000-8000-00000000000a')) = 2, 'listing_price_history: the watcher sees A');
select pg_temp.check((select count(*) from price_drop_watch.listing_price_history(
  '01920000-0000-7000-8000-00000000000b')) = 0, 'listing_price_history: an unwatched listing is empty');
reset role;
set local role nabvy_app;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000b2', true);
select pg_temp.check((select count(*) from price_drop_watch.listing_price_history(
  '01920000-0000-7000-8000-00000000000a')) = 0, 'listing_price_history: another user sees nothing for A');
reset role;
set local role nabvy_app;
select set_config('app.user_id', '', true);
select pg_temp.check((select count(*) from price_drop_watch.listing_price_history(
  '01920000-0000-7000-8000-00000000000a')) = 0, 'listing_price_history: no app.user_id returns nothing');
reset role;

-- Switch gates: off (this module, or listing-suppression) empties both views (rule 11); a
-- suppressed listing is left out while both are on.
update switches.switches set state = 'off' where name = 'price-drop-watch';
set local role nabvy_app;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000b1', true);
select pg_temp.check((select count(*) from app.v_price_drop_watch_watches) = 0,
  'v_price_drop_watch_watches is empty while price-drop-watch is off');
select pg_temp.check((select count(*) from app.v_price_drop_watch_history) = 0,
  'v_price_drop_watch_history is empty while price-drop-watch is off');
reset role;
update switches.switches set state = 'on' where name = 'price-drop-watch';
update switches.switches set state = 'off' where name = 'listing-suppression';
set local role nabvy_app;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000b1', true);
select pg_temp.check((select count(*) from app.v_price_drop_watch_watches) = 0,
  'v_price_drop_watch_watches is empty while listing-suppression is off (fails closed)');
reset role;
update switches.switches set state = 'on' where name = 'listing-suppression';

insert into listing_suppression.entries (kind, value, request_id) values
  ('listing_hash', listing_suppression.listing_hash('facebook', '1816901372840238'),
   '01920000-0000-7000-8000-0000000000f1');
set local role nabvy_app;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000b1', true);
select pg_temp.check((select count(*) from app.v_price_drop_watch_watches) = 0,
  'a suppressed listing is left out of v_price_drop_watch_watches');
select pg_temp.check((select count(*) from app.v_price_drop_watch_history) = 0,
  'a suppressed listing is left out of v_price_drop_watch_history');
reset role;

-- The foundation's view check finds nothing in this module's own schema (its views are in `app`,
-- checked by hand above).
select pg_temp.check(not exists (
  select 1 from nabvy_core.view_violations() v where v::text like '%price_drop_watch%'),
  'no view violations in price_drop_watch');

rollback;
