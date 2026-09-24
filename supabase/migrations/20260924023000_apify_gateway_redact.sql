-- Redacted copies of gateway results, for committing actor output as test fixtures (task 1.0).
-- The actor brief keeps seller data internal only and out of fixtures, so redaction happens here,
-- inside the database: raw seller fields never leave it. Rules:
--   * every object under a `seller` or `marketplace_listing_seller` key becomes a placeholder with
--     the same keys (a numeric ID stays numeric and keeps its length; a token stays a token), and
--     any key this code does not know raises an error instead of passing through;
--   * a string that is a Facebook or Instagram media URL becomes a stable placeholder URL, so the
--     same photo still matches across fields; media URLs inside longer text are replaced too;
--   * Facebook URLs other than Marketplace item links (profiles, pages) become a placeholder;
--   * email addresses and UK phone numbers in any text are masked.
-- Listing IDs, listing URLs, titles, descriptions, prices and approximate locations are kept: they
-- are what the fixtures test.

create function apify_gateway.redact_text(t text) returns text
language sql immutable set search_path = '' as $$
  select case
    when t ~* '^https?://[^/\s]*(fbcdn\.net|fbsbx\.com|cdninstagram\.com)/\S*$'
      then 'https://redacted.invalid/media/' || left(md5(t), 12) || '.jpg'
    else
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              t,
              'https?://[^/\s]*(fbcdn\.net|fbsbx\.com|cdninstagram\.com)/\S*',
              'https://redacted.invalid/media/embedded.jpg', 'gi'),
            'https?://(www\.|m\.|web\.)?facebook\.com/(?!marketplace/)[^\s"<>]*',
            'https://redacted.invalid/facebook', 'gi'),
          '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email redacted]', 'g'),
        '(\+44\s?\(?0?\)?\s?|\m0)(7\d{3}|[1-3]\d{2,3})\s?\d{3}\s?\d{3,4}\M', '[phone redacted]', 'g')
  end
$$;

create function apify_gateway.redact_seller(s jsonb, n integer) returns jsonb
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
        when id ~ '^\d+$' and length(id) > length(n::text) then '9' || lpad(n::text, length(id) - 1, '0')
        when id is null then null
        else 'redacted-token-' || n end);
    elsif k = 'name' then
      out := out || jsonb_build_object(k, case when jsonb_typeof(v) = 'null' then null else '[redacted]' end);
    elsif k = 'profile_picture' then
      if jsonb_typeof(v) = 'object' and exists (
        select 1 from jsonb_object_keys(v) pk where pk not in ('uri', '__typename')
      ) then
        raise exception 'redact_seller: unexpected profile_picture key';
      end if;
      out := out || jsonb_build_object(k, case when jsonb_typeof(v) = 'object'
        then v || jsonb_build_object('uri', 'https://redacted.invalid/profile.jpg') else v end);
    elsif k = '__typename' then
      out := out || jsonb_build_object(k, v);
    else
      raise exception 'redact_seller: unexpected seller key %', k;
    end if;
  end loop;
  return out;
end;
$$;

create function apify_gateway.redact(v jsonb, n integer) returns jsonb
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
      return to_jsonb(apify_gateway.redact_text(v #>> '{}'));
    else
      return v;
  end case;
end;
$$;

-- One job's dataset rows, redacted. The seller placeholder number is the row's position + 1.
create function apify_gateway.redacted_items(p_job_id integer)
returns table (seq integer, item jsonb)
language sql stable set search_path = '' as $$
  select i.seq, apify_gateway.redact(i.item, i.seq + 1)
  from apify_gateway.items i
  where i.job_id = p_job_id
  order by i.seq
$$;

-- Leak check: every seller ID, name and picture URL in the raw rows that still appears anywhere in
-- the redacted rows. Must return nothing before redacted rows are used.
create function apify_gateway.redaction_leaks(p_job_id integer)
returns table (seq integer, field text)
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
    select distinct w.seq, f.field, f.value
    from walk w
    cross join lateral (values
      ('id', w.val ->> 'id'),
      ('name', w.val ->> 'name'),
      ('profile_picture', w.val #>> '{profile_picture,uri}')
    ) as f (field, value)
    where w.key in ('seller', 'marketplace_listing_seller')
      and jsonb_typeof(w.val) = 'object'
      and f.value is not null and length(f.value) >= 3
  ),
  redacted as (
    select string_agg(r.item::text, ' ') as body from apify_gateway.redacted_items(p_job_id) r
  )
  select s.seq, s.field
  from secrets s, redacted r
  where strpos(r.body, s.value) > 0
     or strpos(r.body, replace(s.value, '/', '\/')) > 0
$$;

revoke all on all functions in schema apify_gateway from public, anon, authenticated;
