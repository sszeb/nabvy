-- spec-match module (packages/db/migrations/spec-match): who may write, the unique key and checks,
-- the latest row per want and listing, the switch on every view, the user-facing view's exact
-- columns, row-level isolation between users, its suppression anti-join, its quote redaction and
-- the privileges. Runs in one transaction that is rolled back, on a throwaway database only
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

insert into switches.switches (name, kind, state)
values ('spec-match', 'module', 'on'), ('listing-suppression', 'module', 'on'),
       ('quote-redaction', 'module', 'on'), ('listing-ingest', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- Only the pipeline role writes; anon and authenticated cannot use the schema; nabvy_app has no
-- privilege on the table at all (the stored quotes are verbatim) and reads only through the view.
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'spec_match.matches', p),
  'pipeline may ' || p)
from unnest(array['select', 'insert', 'delete']) as p;
select pg_temp.check(
  has_column_privilege('nabvy_pipeline', 'spec_match.matches', 'matched_at', 'update')
  and not has_column_privilege('nabvy_pipeline', 'spec_match.matches', 'verdict', 'update'),
  'pipeline updates matched_at only');
select pg_temp.check(not has_schema_privilege(r, 'spec_match', 'usage'),
  r || ' has no usage on spec_match')
from unnest(array['anon', 'authenticated']) as r;
select pg_temp.check(not has_any_column_privilege('nabvy_app', 'spec_match.matches', p),
  'nabvy_app has no ' || p || ' on any column of matches')
from unnest(array['select', 'insert', 'update']) as p;
select pg_temp.check(not has_table_privilege('nabvy_app', 'spec_match.matches', 'delete'),
  'nabvy_app cannot delete');
-- The function behind the user-facing view: SECURITY DEFINER, pinned search_path, executable by
-- nabvy_app only (never public or the pipeline: it returns rows).
select pg_temp.check(p.prosecdef and p.proconfig @> array['search_path=pg_catalog'],
  'user_results is security definer with a pinned search_path')
from pg_proc p where p.oid = 'spec_match.user_results()'::regprocedure;
select pg_temp.check(has_function_privilege('nabvy_app', 'spec_match.user_results()', 'execute'),
  'nabvy_app may call user_results');
select pg_temp.check(not has_function_privilege(r, 'spec_match.user_results()', 'execute'),
  r || ' cannot call user_results')
from unnest(array['nabvy_pipeline', 'anon', 'authenticated']) as r;
select pg_temp.check(not has_table_privilege(r, 'spec_match.v_matches', 'select'),
  r || ' cannot read v_matches')
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'spec_match.v_matches', 'select'),
  'pipeline reads v_matches');

-- The user-facing view: granted to nabvy_app and to no other role (rule 5; its future readers
-- outside the web app get their own grant with per-module roles), with exactly these columns.
select pg_temp.check(has_table_privilege('nabvy_app', 'app.v_spec_match_results', 'select'),
  'nabvy_app reads app.v_spec_match_results');
select pg_temp.check(not has_table_privilege(r, 'app.v_spec_match_results', 'select'),
  r || ' cannot read app.v_spec_match_results')
from unnest(array['nabvy_pipeline', 'anon', 'authenticated']) as r;
select pg_temp.check((
  select array_agg(column_name::text order by ordinal_position)
  from information_schema.columns
  where table_schema = 'app' and table_name = 'v_spec_match_results')
  = array['match_id', 'want_id', 'listing_id', 'verdict', 'inside_pc', 'origin', 'backfill',
          'criteria', 'matched_at'],
  'app.v_spec_match_results has exactly the allowed columns');
select pg_temp.check(coalesce(c.reloptions @> array['security_invoker=true'], false),
  n.nspname || '.' || c.relname || ' is security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where (n.nspname = 'spec_match' or (n.nspname = 'app' and c.relname = 'v_spec_match_results'))
  and c.relkind = 'v';

-- Two listings known to listing-ingest, the second suppressed.
insert into listing_ingest.listings (id, source, source_listing_id, card_hash, price_minor,
  currency, title, first_fetched_at, last_seen_at, city_page_id, availability, item_job_id, item_seq)
values
  ('01920000-0000-7000-8000-0000000000c1', 'facebook', 'sm-1', repeat('a', 64), 20000, 'GBP',
   'Gaming PC', now(), now(), '115935195086622', 'live', 1, 0),
  ('01920000-0000-7000-8000-0000000000c2', 'facebook', 'sm-2', repeat('b', 64), 15000, 'GBP',
   'Gaming PC', now(), now(), '115935195086622', 'live', 1, 1);
insert into listing_suppression.entries (kind, value, request_id)
values ('listing_hash', listing_suppression.listing_hash('facebook', 'sm-2'),
  '00000000-0000-7000-8000-000000000043');

-- Matches, written as the pipeline role: user A's want has an older not_stated row and a later
-- match row for listing 1, and a match on the suppressed listing 2; user B's want is no_match.
set local role nabvy_pipeline;
insert into spec_match.matches (want_id, user_id, listing_id, evidence_hash, card_hash,
  input_hash, rule_version, verdict, criteria, inside_pc, origin, backfill, matched_at)
values
  ('01920000-0000-7000-8000-0000000000a1', '01920000-0000-7000-8000-0000000000e1',
   '01920000-0000-7000-8000-0000000000c1', repeat('1', 64), repeat('a', 64), repeat('1', 64),
   's1.00000000', 'not_stated', '[]', true, 'own_search', false, now() - interval '1 hour'),
  ('01920000-0000-7000-8000-0000000000a1', '01920000-0000-7000-8000-0000000000e1',
   '01920000-0000-7000-8000-0000000000c1', repeat('1', 64), repeat('a', 64), repeat('2', 64),
   's1.00000000', 'match',
   '[{"kind": "part", "position": 0, "partType": "gpu", "status": "match", "reason": "named",
      "evidence": [{"seq": 0, "source": "description", "extractor": "rules",
                    "quote": "RTX 5080 call 07700 900123", "start": 0, "end": 26}],
      "distanceKm": null}]',
   true, 'own_search', false, now()),
  ('01920000-0000-7000-8000-0000000000a1', '01920000-0000-7000-8000-0000000000e1',
   '01920000-0000-7000-8000-0000000000c2', repeat('2', 64), repeat('b', 64), repeat('3', 64),
   's1.00000000', 'match', '[]', false, 'other_search', true, now()),
  ('01920000-0000-7000-8000-0000000000a2', '01920000-0000-7000-8000-0000000000e2',
   '01920000-0000-7000-8000-0000000000c1', repeat('1', 64), repeat('a', 64), repeat('4', 64),
   's1.00000000', 'no_match', '[]', true, 'other_search', false, now());
select pg_temp.check((select count(*) from spec_match.v_matches) = 3,
  'v_matches shows the latest row per want and listing');
select pg_temp.check((select verdict from spec_match.v_matches
  where want_id = '01920000-0000-7000-8000-0000000000a1'
    and listing_id = '01920000-0000-7000-8000-0000000000c1') = 'match',
  'the latest row of a pair wins');
-- An earlier row made latest again (its inputs came back) by moving matched_at.
update spec_match.matches set matched_at = now() + interval '1 hour'
where input_hash = repeat('1', 64);
select pg_temp.check((select verdict from spec_match.v_matches
  where want_id = '01920000-0000-7000-8000-0000000000a1'
    and listing_id = '01920000-0000-7000-8000-0000000000c1') = 'not_stated',
  'an earlier row made latest again is shown');
update spec_match.matches set matched_at = now() - interval '1 hour'
where input_hash = repeat('1', 64);
reset role;

-- Unique key and checks.
do $$
begin
  begin
    insert into spec_match.matches (want_id, user_id, listing_id, evidence_hash, input_hash,
      rule_version, verdict, inside_pc, origin, matched_at)
    values ('01920000-0000-7000-8000-0000000000a1', '01920000-0000-7000-8000-0000000000e1',
      '01920000-0000-7000-8000-0000000000c1', repeat('1', 64), repeat('2', 64), 's1.00000000',
      'match', true, 'own_search', now());
    raise exception 'FAILED: a duplicate key was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into spec_match.matches (want_id, user_id, listing_id, evidence_hash, input_hash,
      rule_version, verdict, inside_pc, origin, matched_at)
    values ('01920000-0000-7000-8000-0000000000a1', '01920000-0000-7000-8000-0000000000e1',
      '01920000-0000-7000-8000-0000000000c1', repeat('1', 64), repeat('9', 64), 's1.00000000',
      'maybe', true, 'own_search', now());
    raise exception 'FAILED: an unknown verdict was accepted';
  exception when check_violation then null;
  end;
end;
$$;

-- As user A inside withUser: only A's rows, never the suppressed listing, quotes redacted.
set local role nabvy_app;
select set_config('app.user_id', '01920000-0000-7000-8000-0000000000e1', true);
select pg_temp.check((select count(*) from app.v_spec_match_results) = 1,
  'user A sees one result: the suppressed listing is left out');
select pg_temp.check((select criteria -> 0 -> 'evidence' -> 0 ->> 'quote'
  from app.v_spec_match_results) not like '%07700 900123%',
  'the phone number in the quote is masked');
-- User B: their only verdict is no_match, which is not a result; A's rows stay hidden.
select set_config('app.user_id', '01920000-0000-7000-8000-0000000000e2', true);
select pg_temp.check((select count(*) from app.v_spec_match_results) = 0,
  'user B sees no result and none of user A''s');
do $$
begin
  perform count(*) from spec_match.matches;
  raise exception 'FAILED: nabvy_app read spec_match.matches directly';
exception when insufficient_privilege then null;
end;
$$;
-- Outside withUser: nothing.
select set_config('app.user_id', '', true);
select pg_temp.check((select count(*) from app.v_spec_match_results) = 0,
  'no user set: no rows');
reset role;

-- quote-redaction off: rows stay, quotes are null (fail closed).
update switches.switches set state = 'off' where name = 'quote-redaction';
set local role nabvy_app;
select set_config('app.user_id', '01920000-0000-7000-8000-0000000000e1', true);
select pg_temp.check((select criteria -> 0 -> 'evidence' -> 0 -> 'quote'
  from app.v_spec_match_results) = 'null'::jsonb,
  'quote-redaction off: the quote is null');
reset role;
update switches.switches set state = 'on' where name = 'quote-redaction';

-- listing-suppression off: no user-facing rows at all (rule 11).
update switches.switches set state = 'off' where name = 'listing-suppression';
set local role nabvy_app;
select set_config('app.user_id', '01920000-0000-7000-8000-0000000000e1', true);
select pg_temp.check((select count(*) from app.v_spec_match_results) = 0,
  'listing-suppression off: no user-facing rows');
reset role;
update switches.switches set state = 'on' where name = 'listing-suppression';

-- Shadow: internal rows, no user-facing rows. Off: neither.
update switches.switches set state = 'shadow' where name = 'spec-match';
select pg_temp.check((select count(*) from spec_match.v_matches) = 3, 'shadow: internal rows');
set local role nabvy_app;
select set_config('app.user_id', '01920000-0000-7000-8000-0000000000e1', true);
select pg_temp.check((select count(*) from app.v_spec_match_results) = 0,
  'shadow: no user-facing rows');
reset role;
update switches.switches set state = 'off' where name = 'spec-match';
select pg_temp.check((select count(*) from spec_match.v_matches) = 0, 'off: no internal rows');

-- The view conventions.
select pg_temp.check(not exists (
  select 1 from nabvy_core.view_violations() where view_name like 'spec_match.%'),
  'spec_match views follow the view conventions');

rollback;
