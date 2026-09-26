-- warning-signs module (packages/db/migrations/warning-signs): who may write, the keys and
-- checks, the latest evaluation per listing, the switch on every view, the user-facing view's
-- exact columns and codes, its suppression anti-join, its redaction (fail closed) and its
-- row-level guard, and the privileges. Runs in one transaction that is rolled back, on a
-- throwaway database only (scripts/db-dry-run.sh).
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
values ('warning-signs', 'module', 'on'), ('listing-suppression', 'module', 'on'),
       ('quote-redaction', 'module', 'on'), ('listing-ingest', 'module', 'on'),
       ('detail-evidence', 'module', 'on')
on conflict (name) do update set state = excluded.state;

-- Only the pipeline role writes; anon and authenticated cannot use the schema; nabvy_app reads
-- only the columns the user-facing view reads, and writes nothing.
select pg_temp.check(has_table_privilege('nabvy_pipeline', t, p), 'pipeline may ' || p || ' ' || t)
from unnest(array['warning_signs.evaluations', 'warning_signs.facts']) as t,
     unnest(array['select', 'insert', 'delete']) as p;
select pg_temp.check(not has_table_privilege('nabvy_pipeline', t, 'update'),
  'pipeline has no table-wide update on ' || t)
from unnest(array['warning_signs.evaluations', 'warning_signs.facts']) as t;
select pg_temp.check(
  has_column_privilege('nabvy_pipeline', 'warning_signs.evaluations', 'evaluated_at', 'update')
  and not has_column_privilege('nabvy_pipeline', 'warning_signs.evaluations', 'input_hash', 'update')
  and not has_any_column_privilege('nabvy_pipeline', 'warning_signs.facts', 'update'),
  'pipeline updates evaluations.evaluated_at only');
select pg_temp.check(not has_schema_privilege(r, 'warning_signs', 'usage'),
  r || ' has no usage on warning_signs')
from unnest(array['anon', 'authenticated']) as r;
select pg_temp.check(not has_any_column_privilege('nabvy_app', t, p), 'nabvy_app cannot ' || p || ' ' || t)
from unnest(array['warning_signs.evaluations', 'warning_signs.facts']) as t,
     unnest(array['insert', 'update']) as p;
select pg_temp.check(not has_table_privilege('nabvy_app', t, 'delete'), 'nabvy_app cannot delete ' || t)
from unnest(array['warning_signs.evaluations', 'warning_signs.facts']) as t;
select pg_temp.check(has_column_privilege('nabvy_app', 'warning_signs.evaluations', c, 'select'),
  'nabvy_app reads evaluations.' || c)
from unnest(array['id', 'listing_id', 'evaluated_at']) as c;
select pg_temp.check(not has_column_privilege('nabvy_app', 'warning_signs.evaluations', c, 'select'),
  'nabvy_app cannot read evaluations.' || c)
from unnest(array['evidence_hash', 'card_hash', 'input_hash', 'rule_version', 'fetched_at']) as c;
select pg_temp.check(has_column_privilege('nabvy_app', 'warning_signs.facts', c, 'select'),
  'nabvy_app reads facts.' || c)
from unnest(array['evaluation_id', 'listing_id', 'code', 'evidence_text']) as c;
select pg_temp.check(not has_column_privilege('nabvy_app', 'warning_signs.facts', c, 'select'),
  'nabvy_app cannot read facts.' || c)
from unnest(array['evidence', 'reason', 'rule_id', 'rule_version', 'evidence_hash', 'card_hash']) as c;
select pg_temp.check(not has_table_privilege(r, 'warning_signs.v_facts', 'select'),
  r || ' cannot read v_facts')
from unnest(array['nabvy_app', 'anon', 'authenticated']) as r;
select pg_temp.check(has_table_privilege('nabvy_pipeline', 'warning_signs.v_facts', 'select'),
  'pipeline reads v_facts');

-- The user-facing view: granted to nabvy_app and to no other application role (rule 5), with
-- exactly the allowed columns.
select pg_temp.check(has_table_privilege('nabvy_app', 'app.v_warning_signs', 'select'),
  'nabvy_app reads app.v_warning_signs');
select pg_temp.check(not has_table_privilege(r, 'app.v_warning_signs', 'select'),
  r || ' cannot read app.v_warning_signs')
from unnest(array['nabvy_pipeline', 'anon', 'authenticated']) as r;
select pg_temp.check((
  select array_agg(column_name::text order by ordinal_position)
  from information_schema.columns
  where table_schema = 'app' and table_name = 'v_warning_signs')
  = array['listing_id', 'code', 'evidence_text'],
  'app.v_warning_signs has exactly the allowed columns');

-- Every view is security_invoker.
select pg_temp.check(coalesce(c.reloptions @> array['security_invoker=true'], false),
  n.nspname || '.' || c.relname || ' is security_invoker')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where (n.nspname = 'warning_signs' or (n.nspname = 'app' and c.relname = 'v_warning_signs'))
  and c.relkind = 'v';

-- Two listings known to listing-ingest, the second suppressed.
insert into listing_ingest.listings (id, source, source_listing_id, card_hash, price_minor,
  currency, title, first_fetched_at, last_seen_at, city_page_id, availability, item_job_id, item_seq)
values
  ('01920000-0000-7000-8000-0000000000c1', 'facebook', 'ws-1', repeat('a', 64), 20000, 'GBP',
   'RTX 3090', now(), now(), '115935195086622', 'live', 1, 0),
  ('01920000-0000-7000-8000-0000000000c2', 'facebook', 'ws-2', repeat('b', 64), 15000, 'GBP',
   'RTX 3080', now(), now(), '115935195086622', 'live', 1, 1);
insert into listing_suppression.entries (kind, value, request_id)
values ('listing_hash', listing_suppression.listing_hash('facebook', 'ws-2'),
  '00000000-0000-7000-8000-000000000043');

-- Evaluations and facts, written as the pipeline role: listing 1 has an older evaluation with a
-- pay-first fact and a later one with an untested fact, a contact fact (internal) and a quote
-- carrying a phone number; listing 2 (suppressed) has a mining fact.
set local role nabvy_pipeline;
insert into warning_signs.evaluations (id, listing_id, evidence_hash, card_hash, input_hash,
  rule_version, fetched_at, evaluated_at)
values
  ('01920000-0000-7000-8000-0000000000e1', '01920000-0000-7000-8000-0000000000c1', repeat('1', 64),
   repeat('a', 64), repeat('1', 64), 'w1.00000000', now(), now() - interval '1 hour'),
  ('01920000-0000-7000-8000-0000000000e2', '01920000-0000-7000-8000-0000000000c1', repeat('2', 64),
   repeat('a', 64), repeat('2', 64), 'w1.00000000', now(), now()),
  ('01920000-0000-7000-8000-0000000000e3', '01920000-0000-7000-8000-0000000000c2', repeat('3', 64),
   repeat('b', 64), repeat('3', 64), 'w1.00000000', now(), now());
insert into warning_signs.facts (evaluation_id, listing_id, evidence_hash, card_hash, code, reason,
  evidence, evidence_text, rule_id, rule_version, found_at)
values
  ('01920000-0000-7000-8000-0000000000e1', '01920000-0000-7000-8000-0000000000c1', repeat('1', 64),
   repeat('a', 64), 'pay_first_text', null, '{"type": "quote"}', 'Deposit to hold',
   'warning-signs.pay_first_text', 'w1.00000000', now()),
  ('01920000-0000-7000-8000-0000000000e2', '01920000-0000-7000-8000-0000000000c1', repeat('2', 64),
   repeat('a', 64), 'untested_text', null, '{"type": "quote"}', 'Sold as seen, ring 07700 900123',
   'warning-signs.untested_text', 'w1.00000000', now()),
  ('01920000-0000-7000-8000-0000000000e2', '01920000-0000-7000-8000-0000000000c1', repeat('2', 64),
   repeat('a', 64), 'off_platform_contact_text', null, '{"type": "quote"}', 'ring [phone redacted]',
   'warning-signs.off_platform_contact_text', 'w1.00000000', now()),
  ('01920000-0000-7000-8000-0000000000e2', '01920000-0000-7000-8000-0000000000c1', repeat('2', 64),
   repeat('a', 64), 'low_ask_explained', 'offers', '{"type": "quote"}', 'Offers',
   'warning-signs.low_ask_explained', 'w1.00000000', now()),
  ('01920000-0000-7000-8000-0000000000e3', '01920000-0000-7000-8000-0000000000c2', repeat('3', 64),
   repeat('b', 64), 'mining_text', null, '{"type": "quote"}', 'Ex mining', 'warning-signs.mining_text',
   'w1.00000000', now());
select pg_temp.check((select count(*) from warning_signs.v_facts) = 4,
  'v_facts shows the facts of each listing''s latest evaluation');
select pg_temp.check(not exists (select 1 from warning_signs.v_facts where code = 'pay_first_text'),
  'an older evaluation''s facts are not shown');
-- The replay upsert moves evaluated_at only.
insert into warning_signs.evaluations (listing_id, evidence_hash, card_hash, input_hash,
  rule_version, evaluated_at)
values ('01920000-0000-7000-8000-0000000000c1', repeat('1', 64), repeat('a', 64), repeat('1', 64),
  'w1.00000000', now() + interval '1 hour')
on conflict (listing_id, evidence_hash, card_hash, input_hash, rule_version)
  do update set evaluated_at = excluded.evaluated_at;
select pg_temp.check((select array_agg(code) from warning_signs.v_facts
  where listing_id = '01920000-0000-7000-8000-0000000000c1') = array['pay_first_text'],
  'an earlier evaluation made latest again is shown');
select pg_temp.check((select count(*) from warning_signs.evaluations) = 3,
  'the upsert added no evaluation');
reset role;

-- Keys and checks.
do $$
begin
  begin
    insert into warning_signs.facts (evaluation_id, listing_id, evidence_hash, card_hash, code,
      evidence, rule_id, rule_version, found_at)
    values ('01920000-0000-7000-8000-0000000000e3', '01920000-0000-7000-8000-0000000000c2',
      repeat('3', 64), repeat('b', 64), 'mining_text', '{}', 'warning-signs.mining_text',
      'w1.00000000', now());
    raise exception 'FAILED: a duplicate code in one evaluation was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into warning_signs.facts (evaluation_id, listing_id, evidence_hash, card_hash, code,
      evidence, rule_id, rule_version, found_at)
    values ('01920000-0000-7000-8000-0000000000e3', '01920000-0000-7000-8000-0000000000c2',
      repeat('3', 64), repeat('b', 64), 'scam_score', '{}', 'warning-signs.scam_score',
      'w1.00000000', now());
    raise exception 'FAILED: an unknown code was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into warning_signs.facts (evaluation_id, listing_id, evidence_hash, card_hash, code,
      evidence, rule_id, rule_version, found_at)
    values ('01920000-0000-7000-8000-0000000000e3', '01920000-0000-7000-8000-0000000000c2',
      repeat('3', 64), repeat('b', 64), 'low_ask_explained', '{}',
      'warning-signs.low_ask_explained', 'w1.00000000', now());
    raise exception 'FAILED: low_ask_explained without a reason was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into warning_signs.evaluations (listing_id, evidence_hash, card_hash, input_hash,
      rule_version, evaluated_at)
    values ('01920000-0000-7000-8000-0000000000c2', 'nothex', repeat('b', 64), repeat('9', 64),
      'w1.00000000', now());
    raise exception 'FAILED: a malformed evidence hash was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into warning_signs.evaluations (listing_id, evidence_hash, card_hash, input_hash,
      rule_version, evaluated_at)
    values ('01920000-0000-7000-8000-0000000000c2', repeat('3', 64), repeat('b', 64),
      repeat('8', 64), 'n1.00000000', now());
    raise exception 'FAILED: a foreign rule version was accepted';
  exception when check_violation then null;
  end;
end;
$$;

-- Put listing 1's later evaluation back on top for the user-facing checks.
update warning_signs.evaluations set evaluated_at = now() + interval '2 hours'
where id = '01920000-0000-7000-8000-0000000000e2';

-- On: the user-facing view shows listing 1's untested fact, redacted, never its internal codes
-- or the suppressed listing 2; a direct read of the tables by nabvy_app sees no more.
set local role nabvy_app;
select pg_temp.check((select array_agg(code) from app.v_warning_signs) = array['untested_text'],
  'app.v_warning_signs shows only user-facing codes of the latest evaluation, never a suppressed listing');
select pg_temp.check((select evidence_text from app.v_warning_signs)
  = 'Sold as seen, ring [phone redacted]', 'the evidence text passes through quote-redaction');
select pg_temp.check(not exists (select 1 from warning_signs.facts
  where code in ('off_platform_contact_text', 'low_ask_explained')
     or listing_id = '01920000-0000-7000-8000-0000000000c2'),
  'nabvy_app cannot see internal codes or the suppressed listing in the table');
reset role;

-- quote-redaction off: the fact still shows, with no quote (fail closed).
update switches.switches set state = 'off' where name = 'quote-redaction';
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_warning_signs where evidence_text is null) = 1,
  'quote-redaction off shows the fact without its quote');
reset role;
update switches.switches set state = 'on' where name = 'quote-redaction';

-- Shadow: internal rows, no user-facing row, and the tables hidden from nabvy_app.
update switches.switches set state = 'shadow' where name = 'warning-signs';
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_warning_signs) = 0, 'shadow hides user-facing rows');
select pg_temp.check((select count(*) from warning_signs.facts) = 0
  and (select count(*) from warning_signs.evaluations) = 0,
  'shadow hides the tables from nabvy_app');
reset role;
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from warning_signs.v_facts) = 4, 'shadow shows internal rows');
reset role;

-- Off: both views empty.
update switches.switches set state = 'off' where name = 'warning-signs';
set local role nabvy_pipeline;
select pg_temp.check((select count(*) from warning_signs.v_facts) = 0, 'off empties v_facts');
reset role;
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_warning_signs) = 0,
  'off empties the user-facing view');
reset role;

-- listing-suppression off: the user-facing view is empty even with this module on.
update switches.switches set state = 'on' where name = 'warning-signs';
update switches.switches set state = 'off' where name = 'listing-suppression';
set local role nabvy_app;
select pg_temp.check((select count(*) from app.v_warning_signs) = 0,
  'listing-suppression off empties the user-facing view');
reset role;

-- The foundation's view check finds nothing at all.
select pg_temp.check(not exists (select 1 from nabvy_core.view_violations()),
  'nabvy_core.view_violations() is empty');

rollback;
