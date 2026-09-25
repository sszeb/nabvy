-- parts-record module (packages/db/migrations/parts-record): who may write and what, the unique
-- keys and checks, the latest-record views, the decided inclusion, the switch on every view and
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

insert into switches.switches (name, kind, state) values ('parts-record', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- Only the pipeline role writes, and only what it needs: rows are inserted, never rewritten,
-- except the correction beside a part; nabvy_app, anon and authenticated cannot use the schema.
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'parts_record.' || t, 'insert')
  and has_table_privilege('nabvy_pipeline', 'parts_record.' || t, 'delete')
  and not has_table_privilege('nabvy_pipeline', 'parts_record.' || t, 'update')
  and not has_table_privilege('nabvy_pipeline', 'parts_record.' || t, 'truncate'),
  'pipeline inserts and erases ' || t || ', never rewrites it')
from unnest(array['records', 'parts']) as t;
select pg_temp.check(has_column_privilege('nabvy_pipeline', 'parts_record.parts', 'correction', 'update'),
  'pipeline may record a correction');
select pg_temp.check(not has_column_privilege('nabvy_pipeline', 'parts_record.parts', c, 'update'),
  'pipeline cannot rewrite parts.' || c)
from unnest(array['catalogue_id', 'inclusion', 'quote', 'quote_start', 'part_type', 'conflict']) as c;
select pg_temp.check(not has_schema_privilege(r, 'parts_record', 'usage'),
  r || ' has no usage on parts_record')
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r;
select pg_temp.check(not has_table_privilege(r, 'parts_record.' || v, 'select'),
  r || ' cannot read ' || v)
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r,
     unnest(array['v_records', 'v_parts']) as v;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'parts_record.' || v, 'select'),
  'pipeline reads ' || v)
from unnest(array['v_records', 'v_parts']) as v;

-- No user-facing views (rule 5; quotes reach users through spec-match after redaction).
select pg_temp.check(not exists (
  select 1 from information_schema.views
  where table_schema = 'app' and table_name like 'v\_parts\_record%'), 'no app views');

-- Every view is security_invoker.
select pg_temp.check(coalesce(c.reloptions @> array['security_invoker=true'], false),
  c.relname || ' is security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'parts_record' and c.relkind = 'v';

-- One version, recorded twice: first from the rules alone, then with the AI rows.
set local role nabvy_pipeline;
insert into parts_record.records (id, listing_id, evidence_hash, rule_version, ai_version,
  photo_version, kind, kind_gap, kind_by, kind_source, kind_quote, kind_start, kind_end,
  part_count, conflict, recorded_at)
values ('01920000-0000-7000-8000-00000000aaa1', '01920000-0000-7000-8000-000000000001',
  repeat('a', 64), 'r1.0123abcd', null, null, 'pc', null, 'rules', 'title', 'Gaming PC', 0, 9,
  1, false, now() - interval '1 minute');
insert into parts_record.parts (record_id, listing_id, evidence_hash, seq, part_type,
  catalogue_id, attrs, inclusion, source, extractor, extractor_version, quote, quote_start,
  quote_end)
values ('01920000-0000-7000-8000-00000000aaa1', '01920000-0000-7000-8000-000000000001',
  repeat('a', 64), 0, 'gpu', 'gpu:nvidia:rtx-3060:12gb', '{}', 'offered', 'description', 'rules',
  'r1.0123abcd', 'RTX 3060', 5, 13);
insert into parts_record.records (id, listing_id, evidence_hash, rule_version, ai_version,
  photo_version, kind, kind_gap, kind_by, part_count, conflict)
values ('01920000-0000-7000-8000-00000000aaa2', '01920000-0000-7000-8000-000000000001',
  repeat('a', 64), 'r1.0123abcd', 'p1.0123abcd', null, 'pc', null, 'rules', 2, true);
insert into parts_record.parts (record_id, listing_id, evidence_hash, seq, part_type,
  catalogue_id, attrs, inclusion, source, extractor, extractor_version, quote, quote_start,
  quote_end, conflict)
values
  ('01920000-0000-7000-8000-00000000aaa2', '01920000-0000-7000-8000-000000000001',
   repeat('a', 64), 0, 'gpu', 'gpu:nvidia:rtx-3060:12gb', '{}', 'offered', 'description',
   'rules', 'r1.0123abcd', 'RTX 3060', 5, 13, true),
  ('01920000-0000-7000-8000-00000000aaa2', '01920000-0000-7000-8000-000000000001',
   repeat('a', 64), 1, 'gpu', 'gpu:nvidia:rtx-3070:8gb', '{}', 'offered', 'title', 'ai',
   'p1.0123abcd', 'RTX 3070', 0, 8, true);
-- A second listing whose kind is open.
insert into parts_record.records (listing_id, evidence_hash, rule_version, kind, kind_gap,
  part_count)
values ('01920000-0000-7000-8000-000000000002', repeat('b', 64), 'r1.0123abcd', null,
  'no_signal', 0);
update parts_record.parts set correction = '{"inclusion": "mention", "by": "01920000-0000-7000-8000-000000000009", "reason": "r", "at": "2026-09-25T00:00:00.000Z"}'
where record_id = '01920000-0000-7000-8000-00000000aaa2' and seq = 1;
reset role;

-- Unique keys and checks: one record per listing, hash and set of versions (nulls not
-- distinct); one part per record and seq; known kinds, gaps, part types, inclusions, sources and
-- extractors; a kind either settled (with who and, if quoted, where) or open with its reason;
-- a photo part only from the photo extractor; well-formed versions and positions.
do $$
begin
  begin
    insert into parts_record.records (listing_id, evidence_hash, rule_version, ai_version,
      photo_version, kind, kind_by, part_count)
    values ('01920000-0000-7000-8000-000000000001', repeat('a', 64), 'r1.0123abcd', null, null,
      'pc', 'rules', 0);
    raise exception 'NOT REFUSED: duplicate record (nulls not distinct)';
  exception when unique_violation then null;
  end;
  begin
    insert into parts_record.parts (record_id, listing_id, evidence_hash, seq, part_type,
      inclusion, source, extractor, extractor_version, quote, quote_start, quote_end)
    values ('01920000-0000-7000-8000-00000000aaa2', '01920000-0000-7000-8000-000000000001',
      repeat('a', 64), 0, 'cpu', 'offered', 'title', 'rules', 'r1.0123abcd', 'x', 0, 1);
    raise exception 'NOT REFUSED: duplicate seq';
  exception when unique_violation then null;
  end;
  begin
    insert into parts_record.parts (record_id, listing_id, evidence_hash, seq, part_type,
      inclusion, source, extractor, extractor_version, quote, quote_start, quote_end)
    values ('01920000-0000-7000-8000-00000000aaa2', '01920000-0000-7000-8000-000000000001',
      repeat('a', 64), 7, 'price', 'offered', 'title', 'rules', 'r1.0123abcd', 'x', 0, 1);
    raise exception 'NOT REFUSED: unknown part type';
  exception when check_violation then null;
  end;
  begin
    insert into parts_record.parts (record_id, listing_id, evidence_hash, seq, part_type,
      inclusion, source, extractor, extractor_version, quote, quote_start, quote_end)
    values ('01920000-0000-7000-8000-00000000aaa2', '01920000-0000-7000-8000-000000000001',
      repeat('a', 64), 7, 'gpu', 'maybe', 'title', 'rules', 'r1.0123abcd', 'x', 0, 1);
    raise exception 'NOT REFUSED: unknown inclusion';
  exception when check_violation then null;
  end;
  begin
    insert into parts_record.parts (record_id, listing_id, evidence_hash, seq, part_type,
      inclusion, source, extractor, extractor_version, quote, quote_start, quote_end)
    values ('01920000-0000-7000-8000-00000000aaa2', '01920000-0000-7000-8000-000000000001',
      repeat('a', 64), 7, 'gpu', 'offered', 'photo', 'rules', 'r1.0123abcd', 'x', 0, 1);
    raise exception 'NOT REFUSED: photo source from the rules';
  exception when check_violation then null;
  end;
  begin
    insert into parts_record.parts (record_id, listing_id, evidence_hash, seq, part_type,
      inclusion, source, extractor, extractor_version, quote, quote_start, quote_end)
    values ('01920000-0000-7000-8000-00000000aaa2', '01920000-0000-7000-8000-000000000001',
      repeat('a', 64), 7, 'gpu', 'offered', 'title', 'rules', 'r1.0123abcd', 'x', 4, 4);
    raise exception 'NOT REFUSED: empty position';
  exception when check_violation then null;
  end;
  begin
    insert into parts_record.parts (record_id, listing_id, evidence_hash, seq, part_type,
      inclusion, source, extractor, extractor_version, quote, quote_start, quote_end)
    values ('01920000-0000-7000-8000-00000000aaa9', '01920000-0000-7000-8000-000000000001',
      repeat('a', 64), 7, 'gpu', 'offered', 'title', 'rules', 'r1.0123abcd', 'x', 0, 1);
    raise exception 'NOT REFUSED: part of no record';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into parts_record.records (listing_id, evidence_hash, rule_version, kind, kind_gap,
      part_count)
    values ('01920000-0000-7000-8000-000000000003', repeat('a', 64), 'r1.0123abcd', null, null, 0);
    raise exception 'NOT REFUSED: open kind without its reason';
  exception when check_violation then null;
  end;
  begin
    insert into parts_record.records (listing_id, evidence_hash, rule_version, kind, kind_by,
      kind_quote, part_count)
    values ('01920000-0000-7000-8000-000000000003', repeat('a', 64), 'r1.0123abcd', 'pc',
      'rules', 'PC', 0);
    raise exception 'NOT REFUSED: kind quote without its position';
  exception when check_violation then null;
  end;
  begin
    insert into parts_record.records (listing_id, evidence_hash, rule_version, kind, part_count)
    values ('01920000-0000-7000-8000-000000000003', repeat('a', 64), 'r1.0123abcd', 'pc', 0);
    raise exception 'NOT REFUSED: kind without who settled it';
  exception when check_violation then null;
  end;
  begin
    insert into parts_record.records (listing_id, evidence_hash, rule_version, ai_version, kind,
      kind_by, part_count)
    values ('01920000-0000-7000-8000-000000000003', repeat('a', 64), 'r1.0123abcd', 'v1', 'pc',
      'rules', 0);
    raise exception 'NOT REFUSED: malformed AI version';
  exception when check_violation then null;
  end;
  begin
    insert into parts_record.records (listing_id, evidence_hash, rule_version, kind, kind_by,
      part_count)
    values ('01920000-0000-7000-8000-000000000003', repeat('a', 64), 'rules-1', 'pc', 'rules', 0);
    raise exception 'NOT REFUSED: malformed rule version';
  exception when check_violation then null;
  end;
end;
$$;

-- The pipeline cannot rewrite a stored record or part (column grants).
set local role nabvy_pipeline;
do $$
begin
  begin
    update parts_record.records set kind = 'laptop';
    raise exception 'NOT REFUSED: record rewritten';
  exception when insufficient_privilege then null;
  end;
  begin
    update parts_record.parts set inclusion = 'mention';
    raise exception 'NOT REFUSED: part rewritten';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- The views show the latest record of each version: the one with the AI rows, its two parts,
-- the decided inclusion (the correction over the extractor's), the rejected flag, the positions.
select pg_temp.check((select count(*) from parts_record.v_records) = 2, 'one row per version');
select pg_temp.check((select ai_version from parts_record.v_records
  where listing_id = '01920000-0000-7000-8000-000000000001') = 'p1.0123abcd',
  'v_records shows the latest record');
select pg_temp.check((select parts from parts_record.v_records
  where listing_id = '01920000-0000-7000-8000-000000000001') = 2
  and (select conflict from parts_record.v_records
  where listing_id = '01920000-0000-7000-8000-000000000001'),
  'v_records shows the count and the conflict');
select pg_temp.check((select kind_gap from parts_record.v_records
  where listing_id = '01920000-0000-7000-8000-000000000002') = 'no_signal',
  'v_records shows an open kind');
select pg_temp.check((select count(*) from parts_record.v_parts) = 2,
  'v_parts shows the latest record only');
select pg_temp.check((select inclusion from parts_record.v_parts where seq = 1) = 'mention'
  and (select inclusion from parts_record.v_parts where seq = 0) = 'offered',
  'v_parts decides the inclusion: the correction wins');
select pg_temp.check((select bool_and(not rejected) from parts_record.v_parts),
  'v_parts flags nothing rejected');
select pg_temp.check((select "end" from parts_record.v_parts where seq = 0) = 13
  and (select extractor from parts_record.v_parts where seq = 1) = 'ai',
  'v_parts shows the position and the extractor');
update parts_record.parts set correction = '{"rejected": true, "by": "01920000-0000-7000-8000-000000000009", "reason": "r", "at": "2026-09-25T00:00:00.000Z"}'
where record_id = '01920000-0000-7000-8000-00000000aaa2' and seq = 0;
select pg_temp.check((select rejected from parts_record.v_parts where seq = 0),
  'v_parts flags a rejected part');
reset role;

-- Erasure cascades: deleting a record removes its parts.
set local role nabvy_pipeline;
delete from parts_record.records where listing_id = '01920000-0000-7000-8000-000000000001';
select pg_temp.check((select count(*) from parts_record.parts) = 0, 'parts cascade with records');
reset role;

-- Shadow shows rows; off empties every view.
update switches.switches set state = 'shadow' where name = 'parts-record';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from parts_record.v_records) = 1, 'shadow shows rows');
reset role;
update switches.switches set state = 'off' where name = 'parts-record';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from parts_record.v_records) = 0
  and (select count(*) from parts_record.v_parts) = 0, 'views are empty while off');
reset role;

-- The foundation's view check finds nothing in this schema.
select pg_temp.check(not exists (
  select 1 from nabvy_core.view_violations() v where v::text like '%parts_record%'),
  'no view violations in parts_record');

rollback;
