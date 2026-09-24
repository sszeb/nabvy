-- Apify gateway bootstrap (2026-09-24). See supabase/README.md.
-- Jobs are queued here by SQL and executed by the apify-gateway Edge Function, the only code that
-- holds the Apify token. All spend control lives in this schema, not in the function.
-- Not exposed to the Data API. Raw results can hold seller data: internal only.

create extension if not exists pg_net with schema extensions;

create schema if not exists apify_gateway;
comment on schema apify_gateway is
  'Bootstrap Apify gateway: jobs queued by SQL, run by the apify-gateway Edge Function under a spend cap. Internal only; raw results may hold seller data.';

create table apify_gateway.settings (
  id boolean primary key default true check (id),
  actor_id text not null check (actor_id = 'YfdUav3sZ2BgEf8rh'),
  cap_usd numeric(10, 4) not null check (cap_usd >= 0),
  -- Upper bounds used to reserve a run's worst-case cost before it starts.
  cu_price_usd numeric(10, 4) not null check (cu_price_usd > 0),
  proxy_usd_per_gb numeric(10, 4) not null check (proxy_usd_per_gb > 0),
  max_mb_per_request numeric(10, 4) not null check (max_mb_per_request > 0),
  function_url text not null,
  note text not null
);

insert into apify_gateway.settings
  (actor_id, cap_usd, cu_price_usd, proxy_usd_per_gb, max_mb_per_request, function_url, note)
values (
  'YfdUav3sZ2BgEf8rh', 5.50, 0.40, 10.00, 0.50,
  'https://rlgufxmsrkhyeiabdeic.supabase.co/functions/v1/apify-gateway',
  'Owner budget of £5 for paid runs (2026-09-24), capped at $5.50 so it stays under £5.'
);

create table apify_gateway.jobs (
  id integer generated always as identity primary key,
  kind text not null check (kind in ('env_check', 'actor_info', 'run')),
  input jsonb not null default '{}'::jsonb,
  run_options jsonb not null default '{}'::jsonb,
  reserve_usd numeric(10, 4) not null default 0 check (reserve_usd >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed', 'refused')),
  apify_run_id text,
  cost_usd numeric(10, 4),
  result jsonb,
  error text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'run' or reserve_usd > 0)
);

create table apify_gateway.items (
  job_id integer not null references apify_gateway.jobs (id),
  seq integer not null,
  item jsonb not null,
  primary key (job_id, seq)
);

alter table apify_gateway.settings enable row level security;
alter table apify_gateway.jobs enable row level security;
alter table apify_gateway.items enable row level security;

-- Committed spend: settled cost of finished runs plus the reservation of runs still going.
create view apify_gateway.spend as
select
  s.cap_usd,
  coalesce(sum(coalesce(j.cost_usd, case when j.status = 'running' then j.reserve_usd end)), 0)
    as committed_usd,
  s.cap_usd - coalesce(sum(coalesce(j.cost_usd, case when j.status = 'running' then j.reserve_usd end)), 0)
    as remaining_usd
from apify_gateway.settings s
left join apify_gateway.jobs j on j.kind = 'run'
group by s.cap_usd;

-- Queue a run. Validates the input and reserves its worst-case cost: compute (memory x timeout at
-- the CU price bound) plus proxy traffic (maxRequests x the per-request size bound).
create function apify_gateway.enqueue_run(
  p_input jsonb, p_memory_mb integer, p_timeout_secs integer, p_note text
) returns integer
language plpgsql as $$
declare
  s apify_gateway.settings;
  max_requests integer := (p_input ->> 'maxRequests')::integer;
  run_seconds integer := (p_input ->> 'maxRunSeconds')::integer;
  reserve numeric;
  job_id integer;
begin
  select * into strict s from apify_gateway.settings;
  if p_memory_mb not in (512, 1024, 2048) then
    raise exception 'memory must be 512, 1024 or 2048 MB';
  end if;
  if p_timeout_secs is null or p_timeout_secs < 60 or p_timeout_secs > 1800 then
    raise exception 'timeout must be between 60 and 1800 seconds';
  end if;
  if coalesce((p_input ->> 'inputVersion')::integer, 0) <> 3 then
    raise exception 'input.inputVersion must be 3';
  end if;
  if max_requests is null or max_requests < 1 or max_requests > 1000 then
    raise exception 'input.maxRequests is required, between 1 and 1000';
  end if;
  if run_seconds is null or run_seconds > p_timeout_secs then
    raise exception 'input.maxRunSeconds is required and must not exceed the timeout';
  end if;
  if p_input ? 'startUrls' then
    raise exception 'startUrls is not allowed through the gateway';
  end if;
  if coalesce(p_input ->> 'browserFallback', '') <> 'false' then
    raise exception 'input.browserFallback must be false';
  end if;
  if p_input -> 'proxyConfiguration' is null then
    raise exception 'input.proxyConfiguration is required';
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

-- Claim the oldest pending job for the Edge Function. A run that would take committed spend past
-- the cap is marked refused instead (and still returned, so the caller moves on).
create function apify_gateway.claim_next_job() returns setof apify_gateway.jobs
language plpgsql as $$
declare
  j apify_gateway.jobs;
  cap numeric;
  committed numeric;
begin
  perform pg_advisory_xact_lock(hashtext('apify_gateway.claim'));
  select * into j from apify_gateway.jobs
  where status = 'pending' order by id limit 1 for update skip locked;
  if not found then
    return;
  end if;
  if j.kind = 'run' then
    select sp.cap_usd, sp.committed_usd into cap, committed from apify_gateway.spend sp;
    if committed + j.reserve_usd > cap then
      update apify_gateway.jobs
      set status = 'refused', updated_at = now(),
          error = format('spend cap: committed $%s + reserve $%s > cap $%s', committed, j.reserve_usd, cap)
      where id = j.id
      returning * into j;
      return next j;
      return;
    end if;
  end if;
  update apify_gateway.jobs set status = 'running', updated_at = now()
  where id = j.id returning * into j;
  return next j;
end;
$$;

-- Ask the Edge Function to work through the queue. Returns the pg_net request id; the response
-- lands in net._http_response.
create function apify_gateway.invoke() returns bigint
language sql as $$
  select net.http_post(
    url := (select function_url from apify_gateway.settings),
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 120000
  );
$$;

revoke all on schema apify_gateway from public, anon, authenticated;
revoke all on all tables in schema apify_gateway from public, anon, authenticated;
revoke all on all sequences in schema apify_gateway from public, anon, authenticated;
revoke all on all functions in schema apify_gateway from public, anon, authenticated;
