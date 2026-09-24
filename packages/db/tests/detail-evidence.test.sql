-- detail-evidence module (packages/db/migrations/detail-evidence): who may write, the unique keys,
-- the switch on every view, the current-version rule and the privileges. Runs in one transaction
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

insert into switches.switches (name, kind, state) values ('detail-evidence', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- Only the pipeline role writes; nabvy_app, anon and authenticated cannot even use the schema.
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'detail_evidence.' || t, 'insert'),
  'pipeline inserts ' || t)
from unnest(array['evidence', 'fetches']) as t;
select pg_temp.check(not has_schema_privilege(r, 'detail_evidence', 'usage'),
  r || ' has no usage on detail_evidence')
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r;
select pg_temp.check(not has_table_privilege(r, 'detail_evidence.' || v, 'select'),
  r || ' cannot read ' || v)
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r,
     unnest(array['v_current', 'v_text', 'v_outcomes', 'v_fingerprints']) as v;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'detail_evidence.' || v, 'select'),
  'pipeline reads ' || v)
from unnest(array['v_current', 'v_text', 'v_outcomes', 'v_fingerprints']) as v;

-- No user-facing views (rule 5).
select pg_temp.check(not exists (
  select 1 from information_schema.views
  where table_schema = 'app' and table_name like 'v\_detail\_evidence%'), 'no app views');

-- Every view is security_invoker.
select pg_temp.check(coalesce(c.reloptions @> array['security_invoker=true'], false),
  c.relname || ' is security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'detail_evidence' and c.relkind = 'v';

-- Two versions of one listing: a fresh one (job 1) and a stale-cache one (job 2, later).
set local role nabvy_pipeline;
insert into detail_evidence.evidence (source, source_listing_id, listing_id, evidence_hash,
  first_seen_at, last_seen_at, item_job_id, item_seq, title, description, description_status)
values
  ('facebook', '28242423458759790', '01920000-0000-7000-8000-000000000001', repeat('a', 64),
   '2026-09-24T01:40:43Z', '2026-09-24T01:40:43Z', 1, 0, 'Gaming PC', 'RTX 3060  ', 'full_verified'),
  ('facebook', '28242423458759790', '01920000-0000-7000-8000-000000000001', repeat('b', 64),
   '2026-09-25T01:40:43Z', '2026-09-25T01:40:43Z', 2, 0, 'Gaming PC', 'Older text', 'full_verified');
insert into detail_evidence.fetches (source, source_listing_id, listing_id, job_id, seq,
  fetched_at, detail_outcome, description_status, cache_status, stale_fallback, evidence_hash)
values
  ('facebook', '28242423458759790', '01920000-0000-7000-8000-000000000001', 1, 0,
   '2026-09-24T01:40:43Z', 'collected', 'full_verified', null, false, repeat('a', 64)),
  ('facebook', '28242423458759790', '01920000-0000-7000-8000-000000000001', 2, 0,
   '2026-09-25T01:40:43Z', 'collected', 'full_verified', 'stale-fallback', true, repeat('b', 64));
insert into detail_evidence.fetches (source, source_listing_id, job_id, seq, fetched_at,
  detail_outcome, unresolved)
values ('facebook', '4704995303122642', 3, 0, '2026-09-26T01:40:43Z', 'extraction-error', true);
reset role;

-- Unique keys and checks: one version per listing and hash; one fetch per listing and job; an
-- unresolved fetch carries no version.
do $$
begin
  begin
    insert into detail_evidence.evidence (source, source_listing_id, listing_id, evidence_hash,
      first_seen_at, last_seen_at, item_job_id, item_seq, title)
    values ('facebook', '28242423458759790', '01920000-0000-7000-8000-000000000001',
      repeat('a', 64), now(), now(), 9, 0, 'x');
    raise exception 'NOT REFUSED: duplicate version';
  exception when unique_violation then null;
  end;
  begin
    insert into detail_evidence.fetches (source, source_listing_id, job_id, seq, fetched_at)
    values ('facebook', '28242423458759790', 1, 5, now());
    raise exception 'NOT REFUSED: duplicate fetch';
  exception when unique_violation then null;
  end;
  begin
    insert into detail_evidence.fetches (source, source_listing_id, job_id, seq, fetched_at,
      unresolved, evidence_hash)
    values ('facebook', '1', 4, 0, now(), true, repeat('a', 64));
    raise exception 'NOT REFUSED: unresolved fetch with a version';
  exception when check_violation then null;
  end;
  begin
    insert into detail_evidence.evidence (source, source_listing_id, listing_id, evidence_hash,
      first_seen_at, last_seen_at, item_job_id, item_seq, title, description_status)
    values ('facebook', '1', '01920000-0000-7000-8000-000000000002', repeat('c', 64), now(),
      now(), 9, 0, 'x', 'complete');
    raise exception 'NOT REFUSED: unknown description status';
  exception when check_violation then null;
  end;
end;
$$;

set local role nabvy_pipeline;
select pg_temp.check((select evidence_hash from detail_evidence.v_current) = repeat('a', 64),
  'v_current keeps the fresh version over a later stale-cache one');
select pg_temp.check((select count(*) from detail_evidence.v_text) = 2, 'v_text keeps every version');
select pg_temp.check((select count(*) from detail_evidence.v_outcomes where unresolved) = 1,
  'v_outcomes shows the unresolved fetch');
select pg_temp.check((select fingerprint from detail_evidence.v_fingerprints)
  = encode(sha256(convert_to('rtx 3060', 'UTF8')), 'hex'), 'v_fingerprints hashes the normalised text');
reset role;

-- Off: every view is empty.
update switches.switches set state = 'off' where name = 'detail-evidence';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from detail_evidence.v_current) = 0
  and (select count(*) from detail_evidence.v_text) = 0
  and (select count(*) from detail_evidence.v_outcomes) = 0
  and (select count(*) from detail_evidence.v_fingerprints) = 0, 'views are empty while off');
reset role;

-- The foundation's view check passes for this schema.
select pg_temp.check(not exists (
  select 1 from nabvy_core.view_violations() v where v::text like '%detail_evidence%'),
  'no view violations in detail_evidence');

rollback;
