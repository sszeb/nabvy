-- Gateway input hardening (task 1.1a, 2026-09-24). Nabvy's own conservative policy, adopted by the
-- coordinator from the actor scope report's owner question 9 (docs/fb-actor-scope-report.md).
-- enqueue_run now also refuses:
--   * an Apify timeout less than maxRunSeconds + 60 s. Rows and RUN_SUMMARY are written only at the
--     end, so the timeout must be above maxRunSeconds (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:309-310);
--     60 s is the margin of the recorded run (240 s against 300 s). Same margin as
--     services/source-adapters (TIMEOUT_MARGIN_SECONDS);
--   * useDetailCache other than false: no second durable copy in Apify
--     (fb-scrap-engine/docs/HANDOFF.md:220-221; fb-scrap-engine/docs/design/SCALE_PLAN.md:76-77);
--   * a proxyConfiguration other than Apify RESIDENTIAL with apifyProxyCountry GB
--     (fb-scrap-engine/docs/EVIDENCE_LEDGER.md:77-80,333-336);
--   * an integer field sent as anything but a JSON integer, such as "60" (the schema types are
--     integer: fb-scrap-engine/.actor/input_schema.json);
--   * searchTerms and listingIds in the same run (IDs run after searches, within the result limit:
--     fb-scrap-engine/README.md:73-74).
-- Everything the first version checked is still checked. The migration that created the function
-- (20260924020000) is applied and left unchanged; this replaces the function body only, so its
-- privileges stay revoked. search_path stays pinned (20260924021000).

create or replace function apify_gateway.enqueue_run(
  p_input jsonb, p_memory_mb integer, p_timeout_secs integer, p_note text
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  s apify_gateway.settings;
  max_requests integer;
  run_seconds integer;
  reserve numeric;
  job_id integer;
  key text;
  value jsonb;
  timeout_margin constant integer := 60;
begin
  select * into strict s from apify_gateway.settings;
  if jsonb_typeof(p_input) is distinct from 'object' then
    raise exception 'input must be a JSON object';
  end if;
  if p_memory_mb is null or p_memory_mb not in (512, 1024, 2048) then
    raise exception 'memory must be 512, 1024 or 2048 MB';
  end if;
  if p_timeout_secs is null or p_timeout_secs < 60 or p_timeout_secs > 1800 then
    raise exception 'timeout must be between 60 and 1800 seconds';
  end if;

  -- Integer fields of the actor's input schema must be JSON integers when present.
  foreach key in array array[
    'inputVersion', 'radiusKm', 'detailSessionSize', 'maxListings', 'maxPagesPerSearch',
    'maxDetails', 'maxRequests', 'maxRunSeconds', 'detailConcurrency', 'detailCacheTtlHours',
    'detailCacheRetryMinutes'
  ] loop
    value := p_input -> key;
    if value is not null
      and (jsonb_typeof(value) <> 'number' or value::text::numeric <> trunc(value::text::numeric))
    then
      raise exception 'input.% must be a JSON integer', key;
    end if;
  end loop;

  if p_input -> 'inputVersion' is distinct from '3'::jsonb then
    raise exception 'input.inputVersion must be 3';
  end if;
  max_requests := (p_input ->> 'maxRequests')::integer;
  if max_requests is null or max_requests < 1 or max_requests > 1000 then
    raise exception 'input.maxRequests is required, between 1 and 1000';
  end if;
  run_seconds := (p_input ->> 'maxRunSeconds')::integer;
  if run_seconds is null or p_timeout_secs < run_seconds + timeout_margin then
    raise exception 'input.maxRunSeconds is required, and the timeout must be at least maxRunSeconds + % s',
      timeout_margin;
  end if;
  if p_input ? 'startUrls' then
    raise exception 'startUrls is not allowed through the gateway';
  end if;
  if p_input -> 'browserFallback' is distinct from 'false'::jsonb then
    raise exception 'input.browserFallback must be false';
  end if;
  if p_input -> 'useDetailCache' is distinct from 'false'::jsonb then
    raise exception 'input.useDetailCache must be false';
  end if;
  if p_input -> 'proxyConfiguration' is distinct from
    '{"useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"], "apifyProxyCountry": "GB"}'::jsonb
  then
    raise exception 'input.proxyConfiguration must be Apify RESIDENTIAL with apifyProxyCountry GB';
  end if;
  if jsonb_typeof(p_input -> 'searchTerms') = 'array'
    and jsonb_typeof(p_input -> 'listingIds') = 'array'
    and jsonb_array_length(p_input -> 'searchTerms') > 0
    and jsonb_array_length(p_input -> 'listingIds') > 0
  then
    raise exception 'a run is either searches or a listingIds batch, not both';
  end if;

  reserve := round(
    (p_memory_mb / 1024.0) * (p_timeout_secs / 3600.0) * s.cu_price_usd
      + max_requests * s.max_mb_per_request / 1024.0 * s.proxy_usd_per_gb
      + 0.01,
    4
  );
  insert into apify_gateway.jobs (kind, input, run_options, reserve_usd, note)
  values (
    'run', p_input,
    jsonb_build_object('memory', p_memory_mb, 'timeout', p_timeout_secs),
    reserve, p_note
  )
  returning id into job_id;
  return job_id;
end;
$$;

revoke all on function apify_gateway.enqueue_run(jsonb, integer, integer, text)
  from public, anon, authenticated;
