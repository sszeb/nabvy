-- Redaction v2 (task 1.0), after reading the actor's code in full:
--   * search-card sellers are Facebook's raw objects, unprojected, and item-fetched sellers can
--     carry `short_name` and `profile_picture.url` (fb-scrap-engine src/item-structured.js:85-91),
--     so v1's fail-closed error on unknown keys would block exports. v2 still never passes a
--     seller value through: `id` becomes a placeholder, `__typename` is kept, URL-like keys become a
--     placeholder URL, and every other value in the seller object becomes "[redacted]" (objects
--     and arrays are redacted leaf by leaf, keeping their shape);
--   * text also loses social handles, WhatsApp and Telegram links, and the inward half of full UK
--     postcodes (the outward code, a district, is kept);
--   * the leak check now covers every string inside a seller object except `__typename`.

create or replace function apify_gateway.redact_seller_value(v jsonb, k text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  ck text;
  cv jsonb;
  out jsonb;
begin
  case jsonb_typeof(v)
    when 'object' then
      out := '{}'::jsonb;
      for ck, cv in select * from jsonb_each(v) loop
        out := out || jsonb_build_object(ck,
          case when ck = '__typename' then cv else apify_gateway.redact_seller_value(cv, ck) end);
      end loop;
      return out;
    when 'array' then
      return coalesce(
        (select jsonb_agg(apify_gateway.redact_seller_value(x, k) order by i)
         from jsonb_array_elements(v) with ordinality as t(x, i)),
        '[]'::jsonb);
    when 'string' then
      return to_jsonb(case
        when k in ('uri', 'url', 'src', 'href') or v #>> '{}' ~* '^https?://'
          then 'https://redacted.invalid/seller.jpg'
        else '[redacted]' end);
    when 'null' then
      return v;
    else
      return to_jsonb('[redacted]'::text);
  end case;
end;
$$;

create or replace function apify_gateway.redact_seller(s jsonb, n integer) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v jsonb;
  id text := s ->> 'id';
  out jsonb := '{}'::jsonb;
begin
  for k, v in select * from jsonb_each(s) loop
    if k = 'id' then
      out := out || jsonb_build_object(k, case
        when id is null then null
        when id ~ '^\d+$' and length(id) > length(n::text) then '9' || lpad(n::text, length(id) - 1, '0')
        else 'redacted-token-' || n end);
    elsif k = '__typename' then
      out := out || jsonb_build_object(k, v);
    else
      out := out || jsonb_build_object(k, apify_gateway.redact_seller_value(v, k));
    end if;
  end loop;
  return out;
end;
$$;

create or replace function apify_gateway.redact_text(t text) returns text
language sql immutable set search_path = '' as $$
  select case
    when t ~* '^https?://[^/\s]*(fbcdn\.net|fbsbx\.com|cdninstagram\.com)/\S*$'
      then 'https://redacted.invalid/media/' || left(md5(t), 12) || '.jpg'
    else
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
        t,
        'https?://[^/\s]*(fbcdn\.net|fbsbx\.com|cdninstagram\.com)/\S*',
        'https://redacted.invalid/media/embedded.jpg', 'gi'),
        'https?://(www\.|m\.|web\.)?facebook\.com/(?!marketplace/)[^\s"<>]*',
        'https://redacted.invalid/facebook', 'gi'),
        '(https?://)?(wa\.me|t\.me|api\.whatsapp\.com|instagram\.com|snapchat\.com|tiktok\.com)/[^\s"<>]*',
        '[link redacted]', 'gi'),
        '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email redacted]', 'g'),
        '(^|[^A-Za-z0-9])@[A-Za-z0-9_.]{3,30}', '\1@[handle redacted]', 'g'),
      '(\+44\s?\(?0?\)?\s?|\m0)(7\d{3}|[1-3]\d{2,3})\s?\d{3}\s?\d{3,4}\M', '[phone redacted]', 'g')
  end
$$;

-- Postcodes need case-sensitive matching and run last, so they live in a wrapper.
create or replace function apify_gateway.redact_text_v2(t text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(
    apify_gateway.redact_text(t),
    '\m([A-Z]{1,2}[0-9][0-9A-Z]?)\s?[0-9][ABD-HJLNP-UW-Z]{2}\M',
    '\1 [redacted]', 'g')
$$;

create or replace function apify_gateway.redact(v jsonb, n integer) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  k text;
  e jsonb;
  out jsonb;
begin
  case jsonb_typeof(v)
    when 'object' then
      out := '{}'::jsonb;
      for k, e in select * from jsonb_each(v) loop
        if k in ('seller', 'marketplace_listing_seller') and jsonb_typeof(e) = 'object' then
          out := out || jsonb_build_object(k, apify_gateway.redact_seller(e, n));
        else
          out := out || jsonb_build_object(k, apify_gateway.redact(e, n));
        end if;
      end loop;
      return out;
    when 'array' then
      return coalesce(
        (select jsonb_agg(apify_gateway.redact(x, n) order by i)
         from jsonb_array_elements(v) with ordinality as t(x, i)),
        '[]'::jsonb);
    when 'string' then
      return to_jsonb(apify_gateway.redact_text_v2(v #>> '{}'));
    else
      return v;
  end case;
end;
$$;

-- Every string inside a seller object, except `__typename` values.
create or replace function apify_gateway.seller_strings(v jsonb) returns setof text
language sql immutable set search_path = '' as $$
  with recursive walk (key, val) as (
    select null::text, v
    union all
    select e.key, e.value
    from walk w
    cross join lateral (
      select key, value from jsonb_each(case when jsonb_typeof(w.val) = 'object' then w.val else '{}'::jsonb end)
      union all
      select w.key, value from jsonb_array_elements(case when jsonb_typeof(w.val) = 'array' then w.val else '[]'::jsonb end)
    ) e
  )
  select val #>> '{}' from walk
  where jsonb_typeof(val) = 'string' and coalesce(key, '') <> '__typename'
$$;

drop function apify_gateway.redaction_leaks(integer);

create function apify_gateway.redaction_leaks(p_job_id integer)
returns table (seq integer, value_length integer)
language sql stable set search_path = '' as $$
  with recursive walk (seq, key, val) as (
    select i.seq, null::text, i.item from apify_gateway.items i where i.job_id = p_job_id
    union all
    select w.seq, e.key, e.value
    from walk w
    cross join lateral (
      select key, value from jsonb_each(case when jsonb_typeof(w.val) = 'object' then w.val else '{}'::jsonb end)
      union all
      select w.key, value from jsonb_array_elements(case when jsonb_typeof(w.val) = 'array' then w.val else '[]'::jsonb end)
    ) e
  ),
  secrets as (
    select distinct w.seq, s.value
    from walk w
    cross join lateral apify_gateway.seller_strings(w.val) as s (value)
    where w.key in ('seller', 'marketplace_listing_seller')
      and jsonb_typeof(w.val) = 'object'
      and length(s.value) >= 3
  ),
  redacted as (
    select string_agg(r.item::text, ' ') as body from apify_gateway.redacted_items(p_job_id) r
  )
  select s.seq, length(s.value)
  from secrets s, redacted r
  where strpos(r.body, s.value) > 0
     or strpos(r.body, replace(s.value, '/', '\/')) > 0
$$;

revoke all on all functions in schema apify_gateway from public, anon, authenticated;
