-- copy-advert module (packages/db/migrations/copy-advert): who may write each table, the flags
-- RLS policy and its column grant, restricted_accounts staying out of nabvy_app's reach, and the
-- view conventions (rule 5). Runs in one transaction that is rolled back, on a throwaway database
-- only (scripts/db-dry-run.sh). The trigram baseline against the recorded run (design 4.13, 8) is
-- checked in services/copy-advert/test with the real descriptions; this file only proves the `%`
-- operator and pg_trgm.similarity_threshold work on the real extension.
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
  ('copy-advert', 'module', 'on'), ('listing-ingest', 'module', 'on'),
  ('detail-evidence', 'module', 'on'), ('listing-suppression', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- No Data API role reaches the schema, and every view is security_invoker with no seller-like
-- column (the foundation's check, packages/db/README.md "Views").
select pg_temp.check(not has_schema_privilege(r, 'copy_advert', 'usage'), r || ' has no usage')
from unnest(array['anon', 'authenticated']) as r;
select pg_temp.check(not exists (
  select 1 from nabvy_core.view_violations() where view_name like 'copy_advert.%'),
  'no view violations in copy_advert');

-- Only nabvy_pipeline writes the pipeline tables; nobody but the pipeline reads them either
-- (rule 4: kept away from the Data API, and away from nabvy_app, which reads flags only through
-- its own narrow grant below).
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'copy_advert.' || t, p), 'pipeline may ' || p || ' ' || t)
from unnest(array['prints', 'links', 'photo_matches', 'clusters', 'members', 'candidate_requests', 'overrides']) as t,
     unnest(array['select', 'insert', 'update', 'delete']) as p;
select pg_temp.check(not has_table_privilege(r, 'copy_advert.' || t, 'select'), r || ' cannot read ' || t)
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r,
     unnest(array['prints', 'links', 'photo_matches', 'clusters', 'members', 'candidate_requests', 'overrides', 'account_checks', 'restricted_accounts']) as t;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'copy_advert.restricted_accounts', 'select'),
  'pipeline reads restricted_accounts');

-- reports: user rows. nabvy_app selects and inserts its own (RLS); the pipeline reads every row
-- (for v_review_queue) and deletes (account.deleted purge), never updates.
select pg_temp.check(has_table_privilege('nabvy_app', 'copy_advert.reports', p), 'nabvy_app may ' || p || ' reports')
from unnest(array['select', 'insert']) as p;
select pg_temp.check(not has_table_privilege('nabvy_app', 'copy_advert.reports', p), 'nabvy_app may not ' || p || ' reports')
from unnest(array['update', 'delete']) as p;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'copy_advert.reports', p), 'pipeline may ' || p || ' reports')
from unnest(array['select', 'delete']) as p;

-- flags: nabvy_app has a column-level grant only on the four user-safe columns; the RLS policy
-- gates the rest at read time.
select pg_temp.check(has_column_privilege('nabvy_app', 'copy_advert.flags', c, 'select'), 'nabvy_app reads flags.' || c)
from unnest(array['listing_id', 'towns', 'span_days', 'rule_version']) as c;
select pg_temp.check(not has_column_privilege('nabvy_app', 'copy_advert.flags', c, 'select'), 'nabvy_app cannot read flags.' || c)
from unnest(array['cluster_key', 'would_show', 'corrected', 'member_set_hash']) as c;
select pg_temp.check(not has_table_privilege('nabvy_app', 'copy_advert.flags', p), 'nabvy_app may not ' || p || ' flags')
from unnest(array['insert', 'update', 'delete']) as p;

-- reports: RLS isolation between two users. User 1 inserts and reads its own row; user 2 can
-- neither see nor update it, and cannot insert a row naming another user.
select set_config('app.user_id', '01920000-0000-7000-9000-0000000000f1', false);
set local role nabvy_app;
insert into copy_advert.reports (user_id, listing_id, reason, at)
values ('01920000-0000-7000-9000-0000000000f1', '01920000-0000-7000-9000-00000000000a', 'not_a_copy', now());
select pg_temp.check((select count(*) from copy_advert.reports) = 1, 'user 1 sees its own report');
reset role;
select set_config('app.user_id', '01920000-0000-7000-9000-0000000000f2', false);
set local role nabvy_app;
select pg_temp.check((select count(*) from copy_advert.reports) = 0, 'user 2 sees no report of user 1''s');
do $$
begin
  begin
    insert into copy_advert.reports (user_id, listing_id, reason, at)
    values ('01920000-0000-7000-9000-0000000000f1', '01920000-0000-7000-9000-00000000000b', 'other', now());
    raise exception 'NOT REFUSED: user 2 inserted a report naming user 1';
  exception when others then
    if sqlerrm like 'NOT REFUSED%' then raise; end if;
  end;
end;
$$;
select pg_temp.check((select count(*) from copy_advert.reports where user_id = '01920000-0000-7000-9000-0000000000f1') = 0,
  'the row-security check blocked the cross-user insert; no such report exists');
reset role;
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from copy_advert.reports) = 1, 'the pipeline still sees every report');
delete from copy_advert.reports;
reset role;

-- Two listings, a confirmed exact-text cluster (same title, price and description), one would-show
-- flag, one below flagMinTowns.
insert into listing_ingest.listings (id, source, source_listing_id, card_hash, price_minor,
  currency, title, first_fetched_at, last_seen_at, city_page_id, availability, item_job_id, item_seq)
values
  ('01920000-0000-7000-9000-00000000000a', 'facebook', '9100000000000001', repeat('a', 64), 250000,
   'GBP', 'Gaming PC', now(), now(), '900000000101', 'live', 1, 0),
  ('01920000-0000-7000-9000-00000000000b', 'facebook', '9100000000000002', repeat('b', 64), 250000,
   'GBP', 'Gaming PC', now(), now(), '900000000102', 'live', 2, 0);

set local role nabvy_pipeline;
insert into copy_advert.prints (listing_id, source, source_listing_id, card_hash, evidence_hash,
  rule_version, title_norm, price_minor, currency, advert_fp, desc_status, desc_norm, desc_fp,
  city_page_id, last_seen_at, done_at)
values
  ('01920000-0000-7000-9000-00000000000a', 'facebook', '9100000000000001', repeat('a', 64), '',
   'copy-advert@1', 'gaming pc', 250000, 'GBP', repeat('1', 64), 'full_verified', 'a long enough description text repeated to clear the minimum character threshold for confirmation purposes', repeat('2', 64), '900000000101', now(), now()),
  ('01920000-0000-7000-9000-00000000000b', 'facebook', '9100000000000002', repeat('b', 64), '',
   'copy-advert@1', 'gaming pc', 250000, 'GBP', repeat('1', 64), 'full_verified', 'a long enough description text repeated to clear the minimum character threshold for confirmation purposes', repeat('2', 64), '900000000102', now(), now());

insert into copy_advert.links (listing_a, listing_b, basis, rule_version, decided_at)
values ('01920000-0000-7000-9000-00000000000a', '01920000-0000-7000-9000-00000000000b', 'exact_text', 'copy-advert@1', now());

insert into copy_advert.clusters (cluster_key, rule_version, member_set_hash, price_minor, currency,
  listing_count, town_count, span_days, mass_posted, status, as_of)
values ('deadbeef', 'copy-advert@1', 'feedface', 250000, 'GBP', 2, 2, 0, true, 'active', now());

insert into copy_advert.members (cluster_key, listing_id, source_listing_id, city_page_id, basis, joined_at)
values
  ('deadbeef', '01920000-0000-7000-9000-00000000000a', '9100000000000001', '900000000101', 'exact_text', now()),
  ('deadbeef', '01920000-0000-7000-9000-00000000000b', '9100000000000002', '900000000102', 'exact_text', now());

insert into copy_advert.flags (listing_id, cluster_key, towns, span_days, would_show, rule_version, member_set_hash)
values
  ('01920000-0000-7000-9000-00000000000a', 'deadbeef', 5, 1, true, 'copy-advert@1', 'feedface'),
  ('01920000-0000-7000-9000-00000000000b', 'deadbeef', 2, 0, false, 'copy-advert@1', 'feedface');
reset role;

-- nabvy_app has column privilege only on listing_id, towns, span_days and rule_version (not
-- would_show, cluster_key or corrected, which the RLS policy alone may reference): the row filter
-- comes entirely from the policy, so a plain select of the granted columns already reflects it.
set local role nabvy_app;
select pg_temp.check(
  (select array_agg(listing_id::text order by listing_id) from copy_advert.flags)
  = array['01920000-0000-7000-9000-00000000000a'],
  'nabvy_app sees only the would-show, uncorrected, unsuppressed flag');
reset role;

-- The direct table read (through the RLS policy) matches what a view over the same predicate
-- would show (design 5.1, "the db test reads copy_advert.flags directly ... and expects the same
-- rows as the view").
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from copy_advert.v_listing_copy_facts) = 2, 'v_listing_copy_facts has both members');
select pg_temp.check((select would_show from copy_advert.v_listing_copy_facts
  where listing_id = '01920000-0000-7000-9000-00000000000a'), 'A would show via the view');
select pg_temp.check(not (select would_show from copy_advert.v_listing_copy_facts
  where listing_id = '01920000-0000-7000-9000-00000000000b'), 'B does not show via the view');
reset role;

-- Off: the flags policy and every internal view return no rows (rule 11).
update switches.switches set state = 'off' where name = 'copy-advert';
set local role nabvy_app;
select pg_temp.check((select count(*) from copy_advert.flags) = 0, 'copy-advert off: nabvy_app reads no flag');
reset role;
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from copy_advert.v_members) = 0, 'copy-advert off: v_members is empty');
select pg_temp.check((select count(*) from copy_advert.v_cluster_facts) = 0, 'copy-advert off: v_cluster_facts is empty');
reset role;
update switches.switches set state = 'shadow' where name = 'copy-advert';
set local role nabvy_app;
select pg_temp.check((select count(*) from copy_advert.flags) = 0, 'copy-advert shadow: nabvy_app still reads no flag');
reset role;
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from copy_advert.v_members) = 2, 'copy-advert shadow: internal views still show rows');
reset role;
update switches.switches set state = 'on' where name = 'copy-advert';

-- listing-suppression off: the flags policy requires switches.is_on('listing-suppression').
update switches.switches set state = 'off' where name = 'listing-suppression';
set local role nabvy_app;
select pg_temp.check((select count(*) from copy_advert.flags) = 0,
  'listing-suppression off: nabvy_app reads no flag');
reset role;
update switches.switches set state = 'on' where name = 'listing-suppression';

-- pg_trgm is installed and its threshold config works on the real extension (the Python-baseline
-- comparison against the recorded run is in services/copy-advert/test, with the real descriptions).
-- Schema-qualified: this session's search_path does not include `extensions`, unlike nabvy_app's
-- and nabvy_pipeline's (core migration, "alter role ... set search_path").
select pg_temp.check(
  extensions.similarity('gaming pc rtx 3070 ryzen 7', 'gaming pc rtx 3080 ryzen 9') < 0.8,
  'two different builds score below nearText');
select set_config('pg_trgm.similarity_threshold', '0.8', true);
select pg_temp.check(
  not ('gaming pc rtx 3070' operator(extensions.%) 'gaming pc rtx 3080'),
  'the % operator honours the configured threshold');

rollback;
