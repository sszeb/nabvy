-- quote-redaction: the SQL twin of services/quote-redaction's redact(). Pure functions, no tables.
-- The detector sources, flags and masks match src/domain/patterns.ts verbatim (checked by
-- services/quote-redaction/test/sql-parity.test.ts), and both run the cases in
-- services/quote-redaction/test/fixtures/cases.json (packages/db/tests/quote-redaction.test.sql).
-- Masks use \1, \2 where the TypeScript writes $1, $2.

-- The masked copy of t and what was masked: {"text": ..., "masked": {"email": n, ...}}.
create function quote_redaction.redact_result(t text) returns jsonb
language plpgsql immutable strict parallel safe set search_path = '' as $$
declare
  out text := t;
  masked jsonb := '{"email": 0, "link": 0, "handle": 0, "phone": 0, "postcode": 0}';
  d record;
  n integer;
begin
  for d in
    select * from (values
      (1, 'email', 'gi', '[email redacted]',
        '(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])'),
      (2, 'link', 'gi', '[link redacted]',
        '(?:https?://|www\.)[^\s<>"]*[^\s<>".,;:!?)\]]'),
      (3, 'link', 'gi', '[link redacted]',
        '(?<![A-Za-z0-9._@-])[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9-]+)*\.(?:com|co\.uk|org\.uk|uk|net|org|io|me|shop|store|biz|info)(?![A-Za-z0-9-])(?:/[^\s<>"]*[^\s<>".,;:!?)\]])?'),
      (4, 'handle', 'gi', '[handle redacted]',
        '(?<![A-Za-z0-9._%+-])@[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?'),
      (5, 'handle', 'gi', '\1[handle redacted]',
        '(?<![A-Za-z0-9])((?:insta(?:gram)?|snap(?:chat)?|tiktok|telegram)\s*:\s*)[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?'),
      (6, 'phone', 'g', '[phone redacted]',
        '(?<![A-Za-z0-9+])(?:(?:\+|00)44[\s.-]?(?:\(0\)[\s.-]?)?|\(?0)[1-9][0-9]{1,4}\)?(?:[\s.-]?[0-9]){5,8}(?![0-9])'),
      (7, 'postcode', 'gi', '\1\2 [redacted]',
        '(?<![A-Za-z0-9_])(AB|AL|BA|BB|BD|BF|BH|BL|BN|BR|BS|BT|BX|CA|CB|CF|CH|CM|CO|CR|CT|CV|CW|DA|DD|DE|DG|DH|DL|DN|DT|DY|EC|EH|EN|EX|FK|FY|GL|GU|GY|HA|HD|HG|HP|HR|HS|HU|HX|IG|IM|IP|IV|JE|KA|KT|KW|KY|LA|LD|LE|LL|LN|LS|LU|ME|MK|ML|NE|NG|NN|NP|NR|NW|OL|OX|PA|PE|PH|PL|PO|PR|RG|RH|RM|SA|SE|SG|SK|SL|SM|SN|SO|SP|SR|SS|ST|SW|SY|TA|TD|TF|TN|TQ|TR|TS|TW|UB|WA|WC|WD|WF|WN|WR|WS|WV|YO|ZE|B|E|G|L|M|N|S|W)([0-9][0-9A-Z]?)\s?[0-9][ABD-HJLNP-UW-Z]{2}(?![A-Za-z0-9_])')
    ) as detectors(step, kind, flags, mask, source)
    order by step
  loop
    -- regexp_count takes no 'g'; it counts every non-overlapping match anyway.
    n := regexp_count(out, d.source, 1, replace(d.flags, 'g', ''));
    if n > 0 then
      out := regexp_replace(out, d.source, d.mask, d.flags);
      masked := jsonb_set(masked, array[d.kind], to_jsonb((masked ->> d.kind)::integer + n));
    end if;
  end loop;
  return jsonb_build_object('text', out, 'masked', masked);
end;
$$;

-- The masked copy only, for app. views (for example on listing titles). Null in, null out.
create function quote_redaction.redact(t text) returns text
language sql immutable strict parallel safe set search_path = '' as $$
  select quote_redaction.redact_result(t) ->> 'text'
$$;

-- Whether this module's switch is 'on'. Stub until the switches module exists: it calls
-- switches.is_on('quote-redaction') when that function is there, and otherwise answers false,
-- so quotes fail closed (docs/design rule 11).
create function quote_redaction.switch_on() returns boolean
language plpgsql stable set search_path = '' as $$
declare
  result boolean;
begin
  if to_regprocedure('switches.is_on(text)') is null then
    return false;
  end if;
  execute 'select switches.is_on($1)' into result using 'quote-redaction';
  return coalesce(result, false);
end;
$$;

-- The fail-closed entry point for views that show a quote: the masked copy while the switch is
-- 'on', otherwise null (the view shows no quote).
create function quote_redaction.quote(t text) returns text
language sql stable set search_path = '' as $$
  select case when quote_redaction.switch_on() then quote_redaction.redact(t) end
$$;

-- Callers: the web app's app. views and the pipeline. Never anon or authenticated.
revoke all on function quote_redaction.redact_result(text), quote_redaction.redact(text),
  quote_redaction.switch_on(), quote_redaction.quote(text) from public;
grant usage on schema quote_redaction to nabvy_app, nabvy_pipeline;
grant execute on function quote_redaction.redact_result(text), quote_redaction.redact(text),
  quote_redaction.switch_on(), quote_redaction.quote(text) to nabvy_app, nabvy_pipeline;
