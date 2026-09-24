-- Access for the route_health schema (packages/db/README.md, "Adding tables to a module").
-- route-health holds no user rows: a region's route decision is operational data, not user data,
-- so there is no user_id column and no RLS. Only services/route-health, running as nabvy_pipeline
-- inside a Trigger.dev task, ever writes here.

grant usage on schema route_health to nabvy_pipeline;

grant select, insert, update on route_health.route_state to nabvy_pipeline;
select nabvy_core.track_updated_at('route_health.route_state');

-- Runs are appended, then pruned back to the last 11 per region after every insert (repo,
-- docs/design/modules/route-health.md: "at least 11 entries kept per region"): insert and delete,
-- never update.
grant select, insert, delete on route_health.route_runs to nabvy_pipeline;

-- The read interface for other modules (`details-queue`, `source-health`): security_invoker (a
-- no-op today, since these tables have no RLS, but the standing rule for every v_ view) and one
-- row per region, its latest decision only. Until per-module roles exist, the grant is to
-- nabvy_pipeline, as apify-gateway's internal views do (docs/design/modules/_rules.md, rule 5).
-- Rule 11: no rows while the module is off (an unknown switch reads off, so an unreachable
-- switches also empties this view).
create view route_health.v_decisions with (security_invoker = true) as
  select
    region_id,
    state->'lastDecision'->>'route' as route,
    state->'lastDecision'->>'reason' as reason,
    (state->'lastDecision'->>'successRate')::numeric(5,4) as success_rate,
    (state->'lastDecision'->>'attempts')::integer as attempts,
    coalesce(state->'lastDecision'->'newQueryIds', '[]'::jsonb) as new_query_ids,
    (state->'lastDecision'->>'alert')::boolean as alert,
    updated_at as at
  from route_health.route_state
  where state ? 'lastDecision'
    and switches.state('route-health') <> 'off';
grant select on route_health.v_decisions to nabvy_pipeline;
