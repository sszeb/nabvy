-- quote-redaction: the SQL functions run the same cases as the TypeScript redact(). Rolled back.
-- Run from the repository root by pnpm db:dry-run; the cases come from the module's fixtures.
\set cases `cat services/quote-redaction/test/fixtures/cases.json`
begin;
set local client_min_messages = warning;

create temp table qr_cases on commit drop as
  select value as c from jsonb_array_elements((:'cases'::jsonb) -> 'cases');

do $$
declare
  r record;
  got jsonb;
  nonzero jsonb;
  total integer := 0;
begin
  for r in select c from qr_cases loop
    got := quote_redaction.redact_result(r.c ->> 'input');
    select coalesce(jsonb_object_agg(key, value), '{}') into nonzero
      from jsonb_each(got -> 'masked') where value <> '0'::jsonb;
    if got ->> 'text' is distinct from r.c ->> 'text' then
      raise exception 'case %: text % , expected %', r.c ->> 'id', got ->> 'text', r.c ->> 'text';
    end if;
    if nonzero <> r.c -> 'masked' then
      raise exception 'case %: masked %, expected %', r.c ->> 'id', nonzero, r.c -> 'masked';
    end if;
    if quote_redaction.redact(r.c ->> 'input') is distinct from r.c ->> 'text' then
      raise exception 'case %: redact() differs from redact_result()', r.c ->> 'id';
    end if;
    -- A second pass masks nothing, so a view may apply it to text that is already masked.
    if quote_redaction.redact(r.c ->> 'text') is distinct from r.c ->> 'text' then
      raise exception 'case %: a second pass changed the text', r.c ->> 'id';
    end if;
    total := total + 1;
  end loop;
  if total < 20 then
    raise exception 'only % cases loaded', total;
  end if;
  if quote_redaction.redact(null) is not null then
    raise exception 'redact(null) is not null';
  end if;
end;
$$;

-- Fail closed: the seeded switch is off (task 0.11: switch_on() calls the real
-- switches.is_on('quote-redaction'), no existence check), so quote() shows nothing by default.
do $$
begin
  if quote_redaction.switch_on() or quote_redaction.quote('PO19 1AB') is not null then
    raise exception 'quote() shows text while the switch is off';
  end if;
end;
$$;

-- With the switch on, quote() masks.
update switches.switches set state = 'on' where name = 'quote-redaction';
do $$
begin
  if quote_redaction.quote('Call 07700 900123') is distinct from 'Call [phone redacted]' then
    raise exception 'quote() does not mask while the switch is on';
  end if;
end;
$$;

-- Shadow is not on (rule 11): quote() still shows nothing.
update switches.switches set state = 'shadow' where name = 'quote-redaction';
do $$
begin
  if quote_redaction.quote('Call 07700 900123') is not null then
    raise exception 'quote() shows text while the switch is shadow';
  end if;
end;
$$;
update switches.switches set state = 'off' where name = 'quote-redaction';

-- Callers: nabvy_app and nabvy_pipeline may execute; Supabase's Data API roles may not.
do $$
declare
  f text;
begin
  foreach f in array array['quote_redaction.redact_result(text)', 'quote_redaction.redact(text)',
    'quote_redaction.switch_on()', 'quote_redaction.quote(text)'] loop
    if not has_function_privilege('nabvy_app', f, 'execute')
       or not has_function_privilege('nabvy_pipeline', f, 'execute') then
      raise exception 'an application role cannot execute %', f;
    end if;
    if has_function_privilege('anon', f, 'execute')
       or has_function_privilege('authenticated', f, 'execute') then
      raise exception 'a Data API role can execute %', f;
    end if;
  end loop;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'quote_redaction') then
    raise exception 'quote_redaction owns relations; it should hold functions only';
  end if;
end;
$$;

rollback;
