-- parts-rules module (packages/db/migrations/parts-rules): who may write, the unique keys and
-- checks, the switch on every view, the unnested signal and tag-block views and the privileges.
-- Runs in one transaction that is rolled back, on a throwaway database only
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

insert into switches.switches (name, kind, state) values ('parts-rules', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- Only the pipeline role writes; nabvy_app, anon and authenticated cannot even use the schema.
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'parts_rules.' || t, 'insert'),
  'pipeline inserts ' || t)
from unnest(array['runs', 'rule_parts']) as t;
select pg_temp.check(not has_schema_privilege(r, 'parts_rules', 'usage'),
  r || ' has no usage on parts_rules')
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r;
select pg_temp.check(not has_table_privilege(r, 'parts_rules.' || v, 'select'),
  r || ' cannot read ' || v)
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r,
     unnest(array['v_rule_parts', 'v_gaps', 'v_tag_blocks', 'v_kind_signals']) as v;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'parts_rules.' || v, 'select'),
  'pipeline reads ' || v)
from unnest(array['v_rule_parts', 'v_gaps', 'v_tag_blocks', 'v_kind_signals']) as v;

-- No user-facing views (rule 5).
select pg_temp.check(not exists (
  select 1 from information_schema.views
  where table_schema = 'app' and table_name like 'v\_parts\_rules%'), 'no app views');

-- Every view is security_invoker.
select pg_temp.check(coalesce(c.reloptions @> array['security_invoker=true'], false),
  c.relname || ' is security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'parts_rules' and c.relkind = 'v';

-- One run with a signal and a tag block, and one hit.
set local role nabvy_pipeline;
insert into parts_rules.runs (listing_id, evidence_hash, rule_version, kind, kind_gap,
  kind_signals, tag_blocks, gaps, full_verified)
values ('01920000-0000-7000-8000-000000000001', repeat('a', 64), 'r1.25d64b70', 'pc', null,
  '[{"signal": "pc", "source": "title", "quote": "Gaming PC", "start": 0, "end": 9, "rule_id": "kind.pcTitle"}]',
  '[{"source": "description", "start": 40, "end": 70, "rule_id": "tag.hashtags"}]',
  '[{"partType": "cpu", "reason": "not_stated"}]', true);
insert into parts_rules.rule_parts (listing_id, evidence_hash, rule_version, seq, part_type,
  catalogue_id, attrs, inclusion_candidate, source, quote, quote_start, quote_end, rule_id)
values ('01920000-0000-7000-8000-000000000001', repeat('a', 64), 'r1.25d64b70', 0, 'gpu',
  'gpu:nvidia:rtx-3060:12gb', '{}', 'offered', 'description', 'RTX 3060', 5, 13, 'field.gpu');
reset role;

-- Unique keys and checks: one run per listing, hash and rule version; one hit per seq; known
-- part types, inclusions and sources; a kind or a kind gap, never both.
do $$
begin
  begin
    insert into parts_rules.runs (listing_id, evidence_hash, rule_version, kind, full_verified)
    values ('01920000-0000-7000-8000-000000000001', repeat('a', 64), 'r1.25d64b70', 'pc', true);
    raise exception 'NOT REFUSED: duplicate run';
  exception when unique_violation then null;
  end;
  begin
    insert into parts_rules.rule_parts (listing_id, evidence_hash, rule_version, seq, part_type,
      inclusion_candidate, source, quote, quote_start, quote_end, rule_id)
    values ('01920000-0000-7000-8000-000000000001', repeat('a', 64), 'r1.25d64b70', 0, 'cpu',
      'offered', 'title', 'x', 0, 1, 'field.cpu');
    raise exception 'NOT REFUSED: duplicate seq';
  exception when unique_violation then null;
  end;
  begin
    insert into parts_rules.rule_parts (listing_id, evidence_hash, rule_version, seq, part_type,
      inclusion_candidate, source, quote, quote_start, quote_end, rule_id)
    values ('01920000-0000-7000-8000-000000000001', repeat('a', 64), 'r1.25d64b70', 1, 'price',
      'offered', 'title', 'x', 0, 1, 'field.price');
    raise exception 'NOT REFUSED: unknown part type';
  exception when check_violation then null;
  end;
  begin
    insert into parts_rules.rule_parts (listing_id, evidence_hash, rule_version, seq, part_type,
      inclusion_candidate, source, quote, quote_start, quote_end, rule_id)
    values ('01920000-0000-7000-8000-000000000001', repeat('a', 64), 'r1.25d64b70', 1, 'gpu',
      'offered', 'title', 'x', 4, 4, 'field.gpu');
    raise exception 'NOT REFUSED: empty position';
  exception when check_violation then null;
  end;
  begin
    insert into parts_rules.runs (listing_id, evidence_hash, rule_version, kind, kind_gap,
      full_verified)
    values ('01920000-0000-7000-8000-000000000002', repeat('a', 64), 'r1.25d64b70', 'pc',
      'conflict', true);
    raise exception 'NOT REFUSED: kind and kind gap';
  exception when check_violation then null;
  end;
  begin
    insert into parts_rules.runs (listing_id, evidence_hash, rule_version, kind, full_verified)
    values ('01920000-0000-7000-8000-000000000002', repeat('a', 64), 'v1', 'pc', true);
    raise exception 'NOT REFUSED: malformed rule version';
  exception when check_violation then null;
  end;
end;
$$;

set local role nabvy_pipeline;
select pg_temp.check((select "end" from parts_rules.v_rule_parts) = 13, 'v_rule_parts shows the position');
select pg_temp.check((select quote from parts_rules.v_kind_signals) = 'Gaming PC',
  'v_kind_signals unnests the signals');
select pg_temp.check((select rule_id from parts_rules.v_tag_blocks) = 'tag.hashtags',
  'v_tag_blocks unnests the tag blocks');
select pg_temp.check((select parts from parts_rules.v_gaps)
  = '[{"partType": "cpu", "reason": "not_stated"}]'::jsonb, 'v_gaps shows the open parts');
reset role;

-- Shadow shows rows; off empties every view.
update switches.switches set state = 'shadow' where name = 'parts-rules';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from parts_rules.v_gaps) = 1, 'shadow shows rows');
reset role;
update switches.switches set state = 'off' where name = 'parts-rules';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from parts_rules.v_rule_parts) = 0
  and (select count(*) from parts_rules.v_gaps) = 0
  and (select count(*) from parts_rules.v_tag_blocks) = 0
  and (select count(*) from parts_rules.v_kind_signals) = 0, 'views are empty while off');
reset role;

-- The foundation's view check finds nothing in this schema.
select pg_temp.check(not exists (
  select 1 from nabvy_core.view_violations() v where v::text like '%parts_rules%'),
  'no view violations in parts_rules');

rollback;
