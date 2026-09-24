-- Apify finalises a run's usageTotalUsd a few minutes after the run ends, so the cost read at
-- finish is provisional (the first run read $0.0003 at finish and settled at $0.0177). Until the
-- Edge Function re-reads it (settled_at), a started run counts at the larger of its provisional
-- cost and its reservation, so the cap can only over-count.
alter table apify_gateway.jobs add column settled_at timestamptz;

create or replace view apify_gateway.spend as
select
  s.cap_usd,
  coalesce(sum(c.committed), 0) as committed_usd,
  s.cap_usd - coalesce(sum(c.committed), 0) as remaining_usd
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
) c on true
group by s.cap_usd;

revoke all on apify_gateway.spend from public, anon, authenticated;

-- The first run (job 6, Apify run VkryjpwS6U2GBDh3k) settled at $0.017684833 per Apify.
update apify_gateway.jobs
set cost_usd = 0.0177, settled_at = now(), updated_at = now()
where kind = 'run' and apify_run_id = 'VkryjpwS6U2GBDh3k';
