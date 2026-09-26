-- Access and views for the check_scheduler schema (packages/db/README.md, "Adding tables to a
-- module"; services/check-scheduler/README.md). Depends on core (allow_pipeline,
-- track_updated_at) and switches (switches.state). The module reads search-planner's v_plan and
-- v_one_off_runs, run-coverage's v_search_coverage, spend-governor's v_throttle, source-health's
-- v_ramp_stage and listing-ingest's v_sightings and v_listings from the application layer as
-- nabvy_pipeline, and submits runs only through apify-gateway's submitRun(); none of those is
-- referenced from SQL here.
--
-- The schedule and the runs are pipeline data with no user rows: no user_id, so no user RLS.
-- Only the pipeline role reads and writes them, through allow_pipeline policies, so every other
-- role is denied by default. No delete on check_runs: a run is the record of spend. This module
-- holds no listing rows, so it has nothing for seller-rights erasure (rule 12).

grant usage on schema check_scheduler to nabvy_pipeline;

grant select, insert, update, delete on check_scheduler.schedule to nabvy_pipeline;
select nabvy_core.allow_pipeline('check_scheduler.schedule', 'all');
select nabvy_core.track_updated_at('check_scheduler.schedule');

grant select, insert, update on check_scheduler.check_runs to nabvy_pipeline;
select nabvy_core.allow_pipeline('check_scheduler.check_runs', 'select');
select nabvy_core.allow_pipeline('check_scheduler.check_runs', 'insert');
select nabvy_core.allow_pipeline('check_scheduler.check_runs', 'update');
select nabvy_core.track_updated_at('check_scheduler.check_runs');

-- Internal: every run this module decided (card, "Views"). Regions, terms and job IDs only,
-- never a user ID. Empty while the module is off (rule 11).
create view check_scheduler.v_check_runs with (security_invoker = true) as
select
  r.id,
  r.job_id,
  r.centre_id,
  r.kind,
  r.shape,
  r.terms,
  r.reason,
  r.status,
  r.tick_at,
  r.rerun_of,
  r.one_off_id,
  r.error_code,
  r.created_at,
  r.updated_at
from check_scheduler.check_runs r
where switches.state('check-scheduler') <> 'off';
revoke all on check_scheduler.v_check_runs from public;
grant select on check_scheduler.v_check_runs to nabvy_pipeline;
