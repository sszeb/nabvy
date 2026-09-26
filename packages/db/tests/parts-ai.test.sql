-- parts-ai module (packages/db/migrations/parts-ai): who may write and what, the unique keys and
-- checks, the switch on every view, and the privileges. Runs in one transaction that is rolled
-- back, on a throwaway database only (scripts/db-dry-run.sh).
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

insert into switches.switches (name, kind, state) values ('parts-ai', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- Only the pipeline role writes, and only what it needs: rows are inserted, never rewritten,
-- except the correction beside an AI part; nabvy_app, anon and authenticated cannot use the schema.
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'parts_ai.' || t, 'insert')
  and has_table_privilege('nabvy_pipeline', 'parts_ai.' || t, 'delete')
  and not has_table_privilege('nabvy_pipeline', 'parts_ai.' || t, 'update')
  and not has_table_privilege('nabvy_pipeline', 'parts_ai.' || t, 'truncate'),
  'pipeline inserts and erases ' || t || ', never rewrites it')
from unnest(array['calls', 'ai_parts', 'quarantine', 'refreshes']) as t;
select pg_temp.check(has_column_privilege('nabvy_pipeline', 'parts_ai.ai_parts', 'correction', 'update'),
  'pipeline may record a correction');
select pg_temp.check(not has_column_privilege('nabvy_pipeline', 'parts_ai.ai_parts', c, 'update'),
  'pipeline cannot rewrite ai_parts.' || c)
from unnest(array['catalogue_id', 'inclusion', 'quote', 'quote_start', 'part_type']) as c;
select pg_temp.check(not has_schema_privilege(r, 'parts_ai', 'usage'),
  r || ' has no usage on parts_ai')
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r;
select pg_temp.check(not has_table_privilege(r, 'parts_ai.' || v, 'select'),
  r || ' cannot read ' || v)
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r,
     unnest(array['v_ai_parts', 'v_runs', 'v_quarantine']) as v;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'parts_ai.' || v, 'select'),
  'pipeline reads ' || v)
from unnest(array['v_ai_parts', 'v_runs', 'v_quarantine']) as v;

-- No user-facing views (rule 5), and no cost or model column in any view.
select pg_temp.check(not exists (
  select 1 from information_schema.views
  where table_schema = 'app' and table_name like 'v\_parts\_ai%'), 'no app views');
select pg_temp.check(not exists (
  select 1 from information_schema.columns
  where table_schema = 'parts_ai' and table_name like 'v\_%'
    and column_name in ('cost_gbp_micros', 'model', 'trace_id')), 'no cost or model in views');

-- Every view is security_invoker.
select pg_temp.check(coalesce(c.reloptions @> array['security_invoker=true'], false),
  c.relname || ' is security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'parts_ai' and c.relkind = 'v';

-- One extracted call with a kind and one part; one quarantined call.
set local role nabvy_pipeline;
insert into parts_ai.calls (listing_id, evidence_hash, prompt_version, model, trace_id,
  cost_gbp_micros, status, kind, kind_source, kind_quote, kind_start, kind_end)
values ('01920000-0000-7000-8000-000000000001', repeat('a', 64), 'p1.0123abcd', 'm', 'msg_1',
  1200, 'extracted', 'not_a_pc', 'title', 'Gaming Headset', 3, 17);
insert into parts_ai.ai_parts (listing_id, evidence_hash, prompt_version, seq, part_type,
  catalogue_id, inclusion, source, quote, quote_start, quote_end)
values ('01920000-0000-7000-8000-000000000001', repeat('a', 64), 'p1.0123abcd', 0, 'gpu',
  'gpu:nvidia:rtx-3060:12gb', 'offered', 'description', 'RTX 3060', 5, 13);
insert into parts_ai.calls (listing_id, evidence_hash, prompt_version, model, trace_id,
  cost_gbp_micros, status)
values ('01920000-0000-7000-8000-000000000002', repeat('b', 64), 'p1.0123abcd', 'm', 'msg_2',
  900, 'quarantined');
insert into parts_ai.quarantine (listing_id, evidence_hash, prompt_version, problem, detail)
values ('01920000-0000-7000-8000-000000000002', repeat('b', 64), 'p1.0123abcd',
  'quote_not_found', 'parts[0].quote');
update parts_ai.ai_parts set correction = '{"rejected": true}' where seq = 0;
reset role;

-- Unique keys and checks: one call per listing, hash and prompt version; one part per seq; known
-- part types, inclusions, sources and problems; a kind only on an extracted call, complete.
do $$
begin
  begin
    insert into parts_ai.calls (listing_id, evidence_hash, prompt_version, model, trace_id,
      cost_gbp_micros, status)
    values ('01920000-0000-7000-8000-000000000001', repeat('a', 64), 'p1.0123abcd', 'm', 'x', 0,
      'extracted');
    raise exception 'NOT REFUSED: duplicate call';
  exception when unique_violation then null;
  end;
  begin
    insert into parts_ai.ai_parts (listing_id, evidence_hash, prompt_version, seq, part_type,
      inclusion, source, quote, quote_start, quote_end)
    values ('01920000-0000-7000-8000-000000000001', repeat('a', 64), 'p1.0123abcd', 0, 'cpu',
      'offered', 'title', 'x', 0, 1);
    raise exception 'NOT REFUSED: duplicate seq';
  exception when unique_violation then null;
  end;
  begin
    insert into parts_ai.ai_parts (listing_id, evidence_hash, prompt_version, seq, part_type,
      inclusion, source, quote, quote_start, quote_end)
    values ('01920000-0000-7000-8000-000000000001', repeat('a', 64), 'p1.0123abcd', 1, 'price',
      'offered', 'title', 'x', 0, 1);
    raise exception 'NOT REFUSED: unknown part type';
  exception when check_violation then null;
  end;
  begin
    insert into parts_ai.ai_parts (listing_id, evidence_hash, prompt_version, seq, part_type,
      inclusion, source, quote, quote_start, quote_end)
    values ('01920000-0000-7000-8000-000000000001', repeat('a', 64), 'p1.0123abcd', 1, 'gpu',
      'offered', 'attribute', 'x', 0, 1);
    raise exception 'NOT REFUSED: unknown source';
  exception when check_violation then null;
  end;
  begin
    insert into parts_ai.ai_parts (listing_id, evidence_hash, prompt_version, seq, part_type,
      inclusion, source, quote, quote_start, quote_end)
    values ('01920000-0000-7000-8000-000000000001', repeat('a', 64), 'p1.0123abcd', 1, 'gpu',
      'offered', 'title', 'x', 4, 4);
    raise exception 'NOT REFUSED: empty position';
  exception when check_violation then null;
  end;
  begin
    insert into parts_ai.calls (listing_id, evidence_hash, prompt_version, model, trace_id,
      cost_gbp_micros, status, kind, kind_source, kind_quote, kind_start, kind_end)
    values ('01920000-0000-7000-8000-000000000003', repeat('a', 64), 'p1.0123abcd', 'm', 'x', 0,
      'quarantined', 'pc', 'title', 'PC', 0, 2);
    raise exception 'NOT REFUSED: kind on a quarantined call';
  exception when check_violation then null;
  end;
  begin
    insert into parts_ai.calls (listing_id, evidence_hash, prompt_version, model, trace_id,
      cost_gbp_micros, status, kind)
    values ('01920000-0000-7000-8000-000000000003', repeat('a', 64), 'p1.0123abcd', 'm', 'x', 0,
      'extracted', 'pc');
    raise exception 'NOT REFUSED: kind without its quote';
  exception when check_violation then null;
  end;
  begin
    insert into parts_ai.calls (listing_id, evidence_hash, prompt_version, model, trace_id,
      cost_gbp_micros, status)
    values ('01920000-0000-7000-8000-000000000003', repeat('a', 64), 'v1', 'm', 'x', 0,
      'extracted');
    raise exception 'NOT REFUSED: malformed prompt version';
  exception when check_violation then null;
  end;
  begin
    insert into parts_ai.calls (listing_id, evidence_hash, prompt_version, model, trace_id,
      cost_gbp_micros, status)
    values ('01920000-0000-7000-8000-000000000003', repeat('a', 64), 'p1.0123abcd', 'm', 'x', -1,
      'extracted');
    raise exception 'NOT REFUSED: negative cost';
  exception when check_violation then null;
  end;
  begin
    insert into parts_ai.quarantine (listing_id, evidence_hash, prompt_version, problem, detail)
    values ('01920000-0000-7000-8000-000000000003', repeat('a', 64), 'p1.0123abcd', 'retry', '');
    raise exception 'NOT REFUSED: unknown problem';
  exception when check_violation then null;
  end;
  begin
    insert into parts_ai.refreshes (listing_id, evidence_hash, source, source_listing_id)
    values ('01920000-0000-7000-8000-000000000003', repeat('a', 64), 'facebook', '1'),
           ('01920000-0000-7000-8000-000000000003', repeat('a', 64), 'facebook', '1');
    raise exception 'NOT REFUSED: duplicate refresh';
  exception when unique_violation then null;
  end;
end;
$$;

-- The pipeline cannot rewrite a stored call or part (column grants).
set local role nabvy_pipeline;
do $$
begin
  begin
    update parts_ai.calls set status = 'extracted';
    raise exception 'NOT REFUSED: call rewritten';
  exception when insufficient_privilege then null;
  end;
  begin
    update parts_ai.ai_parts set inclusion = 'mention';
    raise exception 'NOT REFUSED: part rewritten';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select pg_temp.check((select "end" from parts_ai.v_ai_parts) = 13, 'v_ai_parts shows the position');
select pg_temp.check((select correction from parts_ai.v_ai_parts) = '{"rejected": true}'::jsonb,
  'v_ai_parts shows the correction');
select pg_temp.check((select kind from parts_ai.v_runs where status = 'extracted') = 'not_a_pc',
  'v_runs shows the kind');
select pg_temp.check((select problem from parts_ai.v_quarantine) = 'quote_not_found',
  'v_quarantine shows the problem');
reset role;

-- Shadow shows rows; off empties every view.
update switches.switches set state = 'shadow' where name = 'parts-ai';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from parts_ai.v_runs) = 2, 'shadow shows rows');
reset role;
update switches.switches set state = 'off' where name = 'parts-ai';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from parts_ai.v_ai_parts) = 0
  and (select count(*) from parts_ai.v_runs) = 0
  and (select count(*) from parts_ai.v_quarantine) = 0, 'views are empty while off');
reset role;

-- The foundation's view check finds nothing in this schema.
select pg_temp.check(not exists (
  select 1 from nabvy_core.view_violations() v where v::text like '%parts_ai%'),
  'no view violations in parts_ai');

rollback;
