-- Access and views for the source_health schema (packages/db/README.md, "Adding tables to a
-- module"; services/source-health/README.md). Depends on core (track_updated_at), switches
-- (switches.state), apify-gateway (v_run_summaries, v_seller_presence), route-health (v_decisions)
-- and run-coverage (v_search_coverage).
--
-- Daily tallies and the ramp are pipeline data with no user rows, so there is no user_id and no
-- RLS. Only the pipeline role (nabvy_pipeline; per-module roles are question 2 of the catalogue)
-- reads and writes the tables. No delete grant, no `erase`: the module holds no listing rows
-- (rule 12 of docs/design/modules/_rules.md asks `erase` only of modules that hold listing rows).

grant usage on schema source_health to nabvy_pipeline;

-- health_daily is upserted once per Europe/London day (the repo reads-modifies-writes the whole
-- row per collected job); ramp is append-only, one row per stage ever entered, never updated.
grant select, insert, update on source_health.health_daily to nabvy_pipeline;
grant select, insert on source_health.ramp to nabvy_pipeline;

select nabvy_core.track_updated_at('source_health.health_daily');

-- The read interface for other modules: security_invoker, an explicit column allowlist, nothing
-- seller-derived. Empty (or, for the ramp, absent) while the module's switch is off (rule 11), so
-- check-scheduler falls back to the actor's own default; shadow and on show rows.

create view source_health.v_health with (security_invoker = true) as
select
  day,
  total_searches,
  degraded_searches,
  case
    when total_searches = 0 then 0::numeric(5,4)
    else round(degraded_searches::numeric / total_searches, 4)
  end as pct_degraded,
  breaker_trips,
  new_operation_ids,
  blocked_pages,
  alerted,
  updated_at
from source_health.health_daily
where switches.state('source-health') <> 'off';

-- One row: the stage with the latest started_at. Card: "When off: check-scheduler uses the
-- lowest ramp stage" — an empty view (off, or no stage seeded yet) is the reader's signal to fall
-- back, so the reader never queries `ramp` directly.
create view source_health.v_ramp_stage with (security_invoker = true) as
select stage, max_checks_per_day, started_at, advanced_by
from source_health.ramp
where switches.state('source-health') <> 'off'
order by started_at desc
limit 1;

grant select on source_health.v_health, source_health.v_ramp_stage to nabvy_pipeline;
