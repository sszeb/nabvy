-- Access and views for the run_coverage schema (packages/db/README.md, "Adding tables to a
-- module"; services/run-coverage/README.md). Depends on core (track_updated_at), switches
-- (switches.state), apify-gateway (v_jobs, v_run_summaries, v_rows) and listing-ingest
-- (v_sightings, for the page-1 gap check).
--
-- Search judgements and scope baselines are pipeline data with no user rows, so there is no
-- user_id and no RLS. Only the pipeline role (nabvy_pipeline; per-module roles are question 2 of
-- the catalogue) reads and writes the tables. No delete: the module holds no listing rows, so it
-- has nothing for seller-rights erasure (rule 12). nabvy_app gets nothing: this module publishes
-- no user-facing view (rule 5; acquisition modules run before listing-suppression).

grant usage on schema run_coverage to nabvy_pipeline;
grant select, insert, update on run_coverage.search_outcomes, run_coverage.scope_baselines
  to nabvy_pipeline;

select nabvy_core.track_updated_at('run_coverage.search_outcomes');
select nabvy_core.track_updated_at('run_coverage.scope_baselines');

-- Internal views: security_invoker, explicit columns, nothing seller-derived. Empty while the
-- module's switch is off (rule 11), so readers treat coverage as unknown; shadow and on show rows.

create view run_coverage.v_search_coverage with (security_invoker = true) as
select
  o.id, o.job_id, o.search_index, o.centre_id, o.term, o.kind, o.route, o.stop_reason,
  o.reported_route, o.reported_stop_reason, o.pages, o.listings, o.feed_type, o.binding,
  o.page_one_overlap, o.previous_job_id, o.status, o.reasons, o.collected_at,
  o.created_at as done_at
from run_coverage.search_outcomes o
where switches.state('run-coverage') <> 'off';

create view run_coverage.v_scope_baselines with (security_invoker = true) as
select b.centre_id, b.term, b.kind, b.basis, b.first_complete_at, b.job_id, b.search_index
from run_coverage.scope_baselines b
where switches.state('run-coverage') <> 'off';

create view run_coverage.v_search_controls with (security_invoker = true) as
select
  o.job_id, o.search_index, o.control_latitude as latitude, o.control_longitude as longitude,
  o.control_radius_km as radius_km, o.control_sort as sort
from run_coverage.search_outcomes o
where switches.state('run-coverage') <> 'off';

revoke all on run_coverage.v_search_coverage, run_coverage.v_scope_baselines,
  run_coverage.v_search_controls
  from public, anon, authenticated;
grant select on run_coverage.v_search_coverage, run_coverage.v_scope_baselines,
  run_coverage.v_search_controls
  to nabvy_pipeline;
