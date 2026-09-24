-- apify-gateway module (task 1.1c, with the gateway changes of actor-integration.md 3.5 that the
-- live gateway does not have yet). The schema was created by supabase/migrations, which stay the
-- record of what was applied before this module existed (supabase/README.md); nothing applied
-- there is repeated here. Applied migrations are never edited: every change below is new.
--
-- What changes:
--   1. jobs gain tags (requesting module, region, purpose, shape) and three bookkeeping times the
--      watcher sets: metered_at (reservation recorded in cost-meter), announced_at (run-collected
--      emitted) and settle_announced_at (run-settled emitted);
--   2. settings.actor_build pins the actor build (1.0.82, the recorded run's build;
--      docs/questions.md:14), which the Edge Function passes as the run's `build` option;
--   3. the spend cap becomes $150 per calendar month, Europe/London, by the month a run is
--      claimed (claimed_at; created_at for runs claimed before this migration)
--      (docs/decisions.md:138; actor-integration.md 3.5);
--   4. the gateway works only while the module switch `apify-gateway` is not off and the provider
--      switch `apify` and the global `pipeline` switch are on (fail closed; switches.state()
--      reads an unknown name as off);
--   5. enqueue_run(input, memory, timeout, note, tags) for the pipeline, security definer, with
--      the same checks as the owner's four-argument version, which it calls;
--   6. the published views: v_jobs, v_run_summaries, v_rows (no seller objects),
--      v_seller_presence and the restricted restricted_rows, all security_invoker (the foundation's
--      view check covers this schema once this module is in the ledger).

-- 1. Tags and the watcher's bookkeeping. ---------------------------------------------------------
alter table apify_gateway.jobs
  add column tags jsonb not null default '{}'::jsonb,
  add column metered_at timestamptz,
  add column announced_at timestamptz,
  add column settle_announced_at timestamptz,
  add column claimed_at timestamptz,
  add constraint jobs_tags_object check (jsonb_typeof(tags) = 'object');

comment on column apify_gateway.jobs.tags is
  'Who asked and why: {module, region, purpose, shape}; set by enqueue_run(…, p_tags).';
comment on column apify_gateway.jobs.metered_at is
  'When the watcher recorded the run''s reservation in cost-meter.';
comment on column apify_gateway.jobs.announced_at is
  'When the watcher emitted apify-gateway.run-collected for this job (once per job).';
comment on column apify_gateway.jobs.settle_announced_at is
  'When the watcher settled the cost in cost-meter and emitted apify-gateway.run-settled.';

-- The watcher's queries, so they stay cheap as jobs accumulate.
create index jobs_unannounced on apify_gateway.jobs (id) where announced_at is null;
create index jobs_unsettled_announcement on apify_gateway.jobs (id)
  where kind = 'run' and settle_announced_at is null;

-- 2. Build pin. ----------------------------------------------------------------------------------
alter table apify_gateway.settings
  add column actor_build text not null default '1.0.82'
  constraint settings_actor_build check (actor_build ~ '^[0-9]+\.[0-9]+\.[0-9]+$');

-- 3. Monthly cap. --------------------------------------------------------------------------------
-- The calendar month (Europe/London) a time falls in, as its first day.
create function apify_gateway.spend_month(at timestamptz) returns date
language sql stable
set search_path = ''
as $$
  select date_trunc('month', at at time zone 'Europe/London')::date
$$;

-- Committed spend of the current month: runs claimed this month, each at its settled cost once
-- settled, otherwise at the larger of its provisional cost and its reservation
-- (20260924022000_apify_gateway_settle_cost.sql). A run is charged to the month claim_next_job
-- claimed it in, the month the cap was checked against, so a job queued late in one month and
-- claimed in the next counts in the next (review of PR #29). A run claimed on the last day of a
-- month keeps counting in that month, settled or not. Runs claimed before claimed_at existed use
-- created_at. security_invoker: only the owner reads it.
create or replace view apify_gateway.spend with (security_invoker = true) as
select
  s.cap_usd,
  coalesce(sum(c.committed), 0) as committed_usd,
  s.cap_usd - coalesce(sum(c.committed), 0) as remaining_usd,
  apify_gateway.spend_month(now()) as month
from apify_gateway.settings s
left join lateral (
  select
    case
      when j.settled_at is not null then j.cost_usd
      when j.status = 'running' or j.apify_run_id is not null
        then greatest(coalesce(j.cost_usd, 0), j.reserve_usd)
      else 0
    end as committed
  from apify_gateway.jobs j
  where j.kind = 'run'
    and apify_gateway.spend_month(coalesce(j.claimed_at, j.created_at))
      = apify_gateway.spend_month(now())
) c on true
group by s.cap_usd;

update apify_gateway.settings
set cap_usd = 150.00,
    note = 'Owner: an Apify spend cap of $150 a month, reset each calendar month (Europe/London), '
      'with the same worst-case reservations (docs/decisions.md, 2026-09-24).';

-- 4. Switches. -----------------------------------------------------------------------------------
-- True while the gateway may work: module switch not off (on or shadow), provider `apify` on,
-- global `pipeline` on. Any unknown or unreadable switch makes it false.
create function apify_gateway.enabled() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    switches.state('apify-gateway') in ('on', 'shadow')
      and switches.is_on('apify')
      and switches.is_on('pipeline'),
    false
  )
$$;

-- claim_next_job (20260924020000) with three changes: nothing is claimed while the gateway is
-- off, so queued jobs wait, whichever version of the Edge Function asks; paid runs also wait while
-- the cost meter is off; and a claimed run records claimed_at, the month it is charged to.
create or replace function apify_gateway.claim_next_job() returns setof apify_gateway.jobs
language plpgsql
set search_path = ''
as $$
declare
  j apify_gateway.jobs;
  cap numeric;
  committed numeric;
begin
  perform pg_advisory_xact_lock(hashtext('apify_gateway.claim'));
  if not apify_gateway.enabled() then
    return;
  end if;
  -- Paid runs wait while the cost meter is off (rule 11: paid work pauses); free jobs go on.
  select * into j from apify_gateway.jobs
  where status = 'pending'
    and (kind <> 'run' or switches.state('cost-meter') <> 'off')
  order by id limit 1 for update skip locked;
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
  update apify_gateway.jobs
  set status = 'running', updated_at = now(),
      claimed_at = case when j.kind = 'run' then now() end
  where id = j.id returning * into j;
  return next j;
end;
$$;

-- 5. Queueing a run from the pipeline. -----------------------------------------------------------
create function apify_gateway.enqueue_run(
  p_input jsonb, p_memory_mb integer, p_timeout_secs integer, p_note text, p_tags jsonb
) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  job_id integer;
  key text;
begin
  if not apify_gateway.enabled() then
    raise exception 'the apify-gateway module, the apify provider or the pipeline is switched off';
  end if;
  if jsonb_typeof(p_tags) is distinct from 'object' then
    raise exception 'tags must be a JSON object';
  end if;
  for key in select jsonb_object_keys(p_tags) loop
    if key not in ('module', 'region', 'purpose', 'shape') then
      raise exception 'tags.% is not allowed', key;
    end if;
  end loop;
  if coalesce(p_tags ->> 'module', '') !~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' then
    raise exception 'tags.module must name the requesting module';
  end if;
  foreach key in array array['region', 'purpose', 'shape'] loop
    if jsonb_typeof(p_tags -> key) is distinct from 'string'
      or length(p_tags ->> key) not between 1 and 100
    then
      raise exception 'tags.% must be a string of 1 to 100 characters', key;
    end if;
  end loop;

  -- Every input check and the reservation live in the owner's version (20260924030000).
  job_id := apify_gateway.enqueue_run(p_input, p_memory_mb, p_timeout_secs, p_note);
  update apify_gateway.jobs set tags = p_tags where id = job_id;
  return job_id;
end;
$$;

-- invoke() takes no arguments and the Edge Function takes no instructions from the request, so
-- letting the pipeline call it grants nothing beyond "work through the queue now".
alter function apify_gateway.invoke() security definer;

-- 6. Published views. ----------------------------------------------------------------------------
-- The v_ views return no rows while the module is off (rule 11 of docs/design/modules/_rules.md).
-- restricted_rows does not filter: erasure (seller-rights) must reach the rows whatever the switch.
-- A row with every `seller` and `marketplace_listing_seller` key removed, at any depth (the item
-- seller and its copies in sourceFields; supabase/README.md, "Redacted copies for fixtures").
create function apify_gateway.without_seller(v jsonb) returns jsonb
language plpgsql immutable strict parallel safe
set search_path = ''
as $$
begin
  if jsonb_typeof(v) = 'object' then
    return coalesce(
      (select jsonb_object_agg(e.key, apify_gateway.without_seller(e.value))
       from jsonb_each(v) as e
       where e.key not in ('seller', 'marketplace_listing_seller')),
      '{}'::jsonb
    );
  elsif jsonb_typeof(v) = 'array' then
    return coalesce(
      (select jsonb_agg(apify_gateway.without_seller(e.value) order by e.ord)
       from jsonb_array_elements(v) with ordinality as e (value, ord)),
      '[]'::jsonb
    );
  end if;
  return v;
end;
$$;

-- `search` or `details`: from the input of a `run` job (a run holds searches or listingIds, never
-- both: 20260924030000), and from RUN_SUMMARY.searches for a `collect` job, whose input names only
-- the Apify run. Null when neither says.
create function apify_gateway.run_kind(kind text, input jsonb, result jsonb) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when kind = 'run' and jsonb_typeof(input -> 'searchTerms') = 'array'
      and jsonb_array_length(input -> 'searchTerms') > 0 then 'search'
    when kind = 'run' and jsonb_typeof(input -> 'listingIds') = 'array'
      and jsonb_array_length(input -> 'listingIds') > 0 then 'details'
    when kind = 'collect' and jsonb_typeof(result -> 'runSummary' -> 'searches') = 'array' then
      case when jsonb_array_length(result -> 'runSummary' -> 'searches') > 0
        then 'search' else 'details' end
  end
$$;

create view apify_gateway.v_jobs with (security_invoker = true) as
select
  j.id,
  j.kind,
  apify_gateway.run_kind(j.kind, j.input, j.result) as run_kind,
  j.status,
  j.tags,
  j.input,
  (j.run_options ->> 'memory')::integer as memory_mb,
  (j.run_options ->> 'timeout')::integer as timeout_secs,
  j.reserve_usd,
  j.cost_usd,
  j.apify_run_id,
  (j.result ->> 'itemCount')::integer as item_count,
  j.error,
  (j.result ->> 'startedAt')::timestamptz as started_at,
  (j.result ->> 'finishedAt')::timestamptz as finished_at,
  j.settled_at,
  j.announced_at,
  j.created_at,
  j.updated_at
from apify_gateway.jobs j
where switches.state('apify-gateway') <> 'off';

create view apify_gateway.v_run_summaries with (security_invoker = true) as
select
  j.id as job_id,
  j.apify_run_id,
  apify_gateway.run_kind(j.kind, j.input, j.result) as run_kind,
  j.result -> 'runSummary' as summary,
  j.result -> 'runSummary' -> 'detailRoute' as detail_route,
  j.result -> 'runSummary' -> 'searches' as searches
from apify_gateway.jobs j
where jsonb_typeof(j.result -> 'runSummary') = 'object'
  and switches.state('apify-gateway') <> 'off';

create view apify_gateway.v_rows with (security_invoker = true) as
select
  i.job_id,
  i.seq,
  i.item ->> 'recordType' as record_type,
  i.item ->> 'listingId' as listing_id,
  apify_gateway.without_seller(i.item) as item
from apify_gateway.items i
where switches.state('apify-gateway') <> 'off';

create view apify_gateway.v_seller_presence with (security_invoker = true) as
select
  i.job_id,
  i.seq,
  jsonb_typeof(i.item -> 'seller') = 'object' as present
from apify_gateway.items i
where switches.state('apify-gateway') <> 'off';

-- Whole rows, seller fields included: only the seller-data allowlist reads it (rule 6 of
-- docs/design/modules/_rules.md; a conventions test in services/apify-gateway enforces it until
-- per-module roles exist). Never named v_ and never granted to nabvy_app.
create view apify_gateway.restricted_rows with (security_invoker = true) as
select i.job_id, i.seq, i.item
from apify_gateway.items i;

-- 7. Privileges. ---------------------------------------------------------------------------------
-- New functions are executable by PUBLIC by default; take that back first.
revoke all on function
  apify_gateway.spend_month(timestamptz),
  apify_gateway.enabled(),
  apify_gateway.enqueue_run(jsonb, integer, integer, text, jsonb),
  apify_gateway.without_seller(jsonb),
  apify_gateway.run_kind(text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on apify_gateway.v_jobs, apify_gateway.v_run_summaries, apify_gateway.v_rows,
  apify_gateway.v_seller_presence, apify_gateway.restricted_rows
  from public, anon, authenticated;

-- The pipeline role (no per-module roles yet: rule 4 of docs/design/modules/_rules.md) may queue runs, invoke the
-- gateway, read the published views and set the watcher's three times. The views are
-- security_invoker, so the role also needs SELECT on the two tables beneath them; RLS admits it
-- through pipeline policies. Which packages may name the tables, restricted_rows or enqueue_run
-- is checked by services/apify-gateway/test/conventions.test.ts.
grant usage on schema apify_gateway to nabvy_pipeline;
grant execute on function
  apify_gateway.enqueue_run(jsonb, integer, integer, text, jsonb),
  apify_gateway.invoke(),
  apify_gateway.without_seller(jsonb),
  apify_gateway.run_kind(text, jsonb, jsonb)
  to nabvy_pipeline;
grant select on apify_gateway.jobs, apify_gateway.items to nabvy_pipeline;
grant update (metered_at, announced_at, settle_announced_at) on apify_gateway.jobs to nabvy_pipeline;
select nabvy_core.allow_pipeline('apify_gateway.jobs', 'select');
select nabvy_core.allow_pipeline('apify_gateway.jobs', 'update');
select nabvy_core.allow_pipeline('apify_gateway.items', 'select');
grant select on apify_gateway.v_jobs, apify_gateway.v_run_summaries, apify_gateway.v_rows,
  apify_gateway.v_seller_presence, apify_gateway.restricted_rows
  to nabvy_pipeline;

-- The watcher's times move forward only: once set, never cleared or changed.
create function apify_gateway.keep_watch_times() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.metered_at is not null and new.metered_at is distinct from old.metered_at)
    or (old.announced_at is not null and new.announced_at is distinct from old.announced_at)
    or (old.settle_announced_at is not null
        and new.settle_announced_at is distinct from old.settle_announced_at)
  then
    raise exception 'apify_gateway.jobs: a watcher time, once set, never changes';
  end if;
  return new;
end;
$$;
revoke all on function apify_gateway.keep_watch_times() from public, anon, authenticated;
create trigger keep_watch_times before update on apify_gateway.jobs
  for each row execute function apify_gateway.keep_watch_times();
