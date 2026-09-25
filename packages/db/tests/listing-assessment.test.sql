-- listing-assessment module (packages/db/migrations/listing-assessment): who may write and what,
-- the unique key and checks, the latest-assessment views with parts-record's kind beside them,
-- the corrected decisions, the unknowns, the switch on every view and the privileges. Runs in
-- one transaction that is rolled back, on a throwaway database only (scripts/db-dry-run.sh).
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
values ('listing-assessment', 'module', 'on'), ('parts-record', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- Only the pipeline role writes, and only what it needs: rows are inserted, never rewritten,
-- except the correction beside an assessment; nabvy_app, anon and authenticated cannot use the
-- schema.
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'listing_assessment.assessments', 'insert')
  and has_table_privilege('nabvy_pipeline', 'listing_assessment.assessments', 'delete')
  and not has_table_privilege('nabvy_pipeline', 'listing_assessment.assessments', 'update')
  and not has_table_privilege('nabvy_pipeline', 'listing_assessment.assessments', 'truncate'),
  'pipeline inserts and erases assessments, never rewrites them');
select pg_temp.check(has_column_privilege('nabvy_pipeline', 'listing_assessment.assessments',
  'correction', 'update'), 'pipeline may record a correction');
select pg_temp.check(not has_column_privilege('nabvy_pipeline', 'listing_assessment.assessments',
  c, 'update'), 'pipeline cannot rewrite assessments.' || c)
from unnest(array['form', 'container', 'gpu_state', 'cautions', 'assessed_at', 'record_hash']) as c;
select pg_temp.check(not has_schema_privilege(r, 'listing_assessment', 'usage'),
  r || ' has no usage on listing_assessment')
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r;
select pg_temp.check(not has_table_privilege(r, 'listing_assessment.' || v, 'select'),
  r || ' cannot read ' || v)
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r,
     unnest(array['v_assessments', 'v_unknowns']) as v;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'listing_assessment.' || v, 'select'),
  'pipeline reads ' || v)
from unnest(array['v_assessments', 'v_unknowns']) as v;

-- No user-facing views (rule 5), and no kind column: parts-record owns the kind.
select pg_temp.check(not exists (
  select 1 from information_schema.views
  where table_schema = 'app' and table_name like 'v\_listing\_assessment%'), 'no app views');
select pg_temp.check(not exists (
  select 1 from information_schema.columns
  where table_schema = 'listing_assessment' and table_name = 'assessments'
    and column_name = 'kind'), 'no stored kind');

-- Every view is security_invoker.
select pg_temp.check(coalesce(c.reloptions @> array['security_invoker=true'], false),
  c.relname || ' is security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'listing_assessment' and c.relkind = 'v';

-- parts-record's record for one version, then two assessments of it: the first against an older
-- record, the second (later) against the current one.
insert into parts_record.records (listing_id, evidence_hash, rule_version, kind, kind_by,
  part_count)
values ('01920000-0000-7000-8000-000000000001', repeat('a', 64), 'r1.0123abcd', 'pc', 'rules', 0);
set local role nabvy_pipeline;
insert into listing_assessment.assessments (id, listing_id, evidence_hash, card_hash,
  record_hash, rule_version, form, container, container_reason, gpu_state, cautions, coverage,
  unknowns, assessed_at)
values
  ('01920000-0000-7000-8000-00000000aaa1', '01920000-0000-7000-8000-000000000001',
   repeat('a', 64), repeat('c', 64), repeat('1', 64), 'a1.0123abcd', 'system', true, 'kind',
   'not_stated', '[]', '{"title": true, "fullDescription": true, "photos": false}',
   '["gpu", "cpu"]', now() - interval '1 minute'),
  ('01920000-0000-7000-8000-00000000aaa2', '01920000-0000-7000-8000-000000000001',
   repeat('a', 64), repeat('c', 64), repeat('2', 64), 'a1.0123abcd', 'bundle', true, 'kind',
   'not_stated', '["bundle_price"]', '{"title": true, "fullDescription": true, "photos": false}',
   '["gpu", "storage_size"]', now()),
  -- A second listing, a placed headset with no card and no parts record.
  ('01920000-0000-7000-8000-00000000aaa3', '01920000-0000-7000-8000-000000000002',
   repeat('b', 64), null, repeat('3', 64), 'a1.0123abcd', 'unknown', false, 'placed',
   'not_stated', '[]', '{"title": true, "fullDescription": false, "photos": false}', '[]', now());
reset role;

-- Unique key and checks: one row per listing, hash, card hash, record hash and rule version
-- (nulls not distinct); known forms, reasons and GPU states; `placed` or `box_only` exactly when
-- not a container; well-formed hashes and versions; arrays and an object where they belong.
do $$
begin
  begin
    insert into listing_assessment.assessments (listing_id, evidence_hash, card_hash, record_hash,
      rule_version, form, container, container_reason, gpu_state, coverage, assessed_at)
    values ('01920000-0000-7000-8000-000000000002', repeat('b', 64), null, repeat('3', 64),
      'a1.0123abcd', 'unknown', false, 'placed', 'not_stated', '{}', now());
    raise exception 'NOT REFUSED: duplicate assessment (nulls not distinct)';
  exception when unique_violation then null;
  end;
  begin
    insert into listing_assessment.assessments (listing_id, evidence_hash, record_hash,
      rule_version, form, container, container_reason, gpu_state, coverage, assessed_at)
    values ('01920000-0000-7000-8000-000000000003', repeat('b', 64), repeat('3', 64),
      'a1.0123abcd', 'unknown', true, 'placed', 'not_stated', '{}', now());
    raise exception 'NOT REFUSED: a placed container';
  exception when check_violation then null;
  end;
  begin
    insert into listing_assessment.assessments (listing_id, evidence_hash, record_hash,
      rule_version, form, container, container_reason, gpu_state, coverage, assessed_at)
    values ('01920000-0000-7000-8000-000000000003', repeat('b', 64), repeat('3', 64),
      'a1.0123abcd', 'tower', true, 'kind', 'not_stated', '{}', now());
    raise exception 'NOT REFUSED: unknown form';
  exception when check_violation then null;
  end;
  begin
    insert into listing_assessment.assessments (listing_id, evidence_hash, record_hash,
      rule_version, form, container, container_reason, gpu_state, coverage, assessed_at)
    values ('01920000-0000-7000-8000-000000000003', repeat('b', 64), repeat('3', 64),
      'a1.0123abcd', 'system', true, 'kind', 'maybe', '{}', now());
    raise exception 'NOT REFUSED: unknown GPU state';
  exception when check_violation then null;
  end;
  begin
    insert into listing_assessment.assessments (listing_id, evidence_hash, record_hash,
      rule_version, form, container, container_reason, gpu_state, coverage, assessed_at)
    values ('01920000-0000-7000-8000-000000000003', repeat('b', 64), repeat('3', 64),
      'r1.0123abcd', 'system', true, 'kind', 'named', '{}', now());
    raise exception 'NOT REFUSED: malformed rule version';
  exception when check_violation then null;
  end;
  begin
    insert into listing_assessment.assessments (listing_id, evidence_hash, record_hash,
      rule_version, form, container, container_reason, gpu_state, cautions, coverage, assessed_at)
    values ('01920000-0000-7000-8000-000000000003', repeat('b', 64), repeat('3', 64),
      'a1.0123abcd', 'system', true, 'kind', 'named', '"box_only"', '{}', now());
    raise exception 'NOT REFUSED: cautions not an array';
  exception when check_violation then null;
  end;
  begin
    insert into listing_assessment.assessments (listing_id, evidence_hash, record_hash,
      rule_version, form, container, container_reason, gpu_state, coverage, assessed_at)
    values ('01920000-0000-7000-8000-000000000003', 'xyz', repeat('3', 64),
      'a1.0123abcd', 'system', true, 'kind', 'named', '{}', now());
    raise exception 'NOT REFUSED: malformed evidence hash';
  exception when check_violation then null;
  end;
end;
$$;

-- The views show the latest assessment of each version, parts-record's kind beside it (null
-- where there is no record), and the unknowns of containers only.
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from listing_assessment.v_assessments) = 2,
  'one row per listing version');
select pg_temp.check((select form = 'bundle' and kind = 'pc' from listing_assessment.v_assessments
  where listing_id = '01920000-0000-7000-8000-000000000001'), 'latest row, with the record''s kind');
select pg_temp.check((select kind is null from listing_assessment.v_assessments
  where listing_id = '01920000-0000-7000-8000-000000000002'), 'no record: the kind reads null');
select pg_temp.check((select array_agg(part_type order by part_type) from listing_assessment.v_unknowns)
  = array['gpu', 'storage_size'], 'unknowns of the latest container row only');

-- A reviewer's correction shows in the decisions and drops a GPU it states from the unknowns.
update listing_assessment.assessments
set correction = '{"gpuState": "none", "container": true, "by": "01920000-0000-7000-8000-000000000009", "reason": "r", "at": "2026-09-25T00:00:00.000Z"}'
where id = '01920000-0000-7000-8000-00000000aaa2';
select pg_temp.check((select gpu_state = 'none' and correction ->> 'reason' = 'r'
  from listing_assessment.v_assessments where listing_id = '01920000-0000-7000-8000-000000000001'),
  'v_assessments applies the correction and shows it');
select pg_temp.check((select array_agg(part_type) from listing_assessment.v_unknowns)
  = array['storage_size'], 'a corrected GPU is not an unknown');
reset role;

-- parts-record off: the kind reads null, the assessment stays.
update switches.switches set state = 'off' where name = 'parts-record';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) filter (where kind is not null) = 0 and count(*) = 2
  from listing_assessment.v_assessments), 'kind unknown while parts-record is off');
reset role;

-- Shadow shows rows; off empties every view.
update switches.switches set state = 'shadow' where name = 'listing-assessment';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from listing_assessment.v_assessments) = 2, 'shadow shows rows');
reset role;
update switches.switches set state = 'off' where name = 'listing-assessment';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from listing_assessment.v_assessments) = 0
  and (select count(*) from listing_assessment.v_unknowns) = 0, 'views are empty while off');
-- Erasure.
delete from listing_assessment.assessments where listing_id = '01920000-0000-7000-8000-000000000001';
select pg_temp.check((select count(*) from listing_assessment.assessments) = 1, 'erase removes rows');
reset role;

-- The foundation's view check finds nothing in this schema.
select pg_temp.check(not exists (
  select 1 from nabvy_core.view_violations() v where v::text like '%listing_assessment%'),
  'no view violations in listing_assessment');

rollback;
