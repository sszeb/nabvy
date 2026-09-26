-- Access and views for the search_planner schema (packages/db/README.md, "Adding tables to a
-- module"; services/search-planner/README.md). Depends on core (allow_pipeline,
-- track_updated_at) and switches (switches.state). The module reads want-manager's
-- v_want_terms_by_centre and city-pages' v_centres from the application layer as
-- nabvy_pipeline, and writes audit rows through @nabvy/audit-log's record(); none of those is
-- referenced from SQL here.
--
-- Plans and one-off runs are pipeline data with no user rows: no user_id, so no user RLS. Only
-- the pipeline role (nabvy_pipeline; per-module roles are question 2 of the catalogue) reads and
-- writes them, through allow_pipeline policies, so every other role is denied by default.
-- `one_off_runs.approved_by` (the approver's user ID) is on no view. No delete on one-off runs:
-- a run is cancelled, never removed. This module holds no listing rows, so it has nothing for
-- seller-rights erasure (rule 12).

grant usage on schema search_planner to nabvy_pipeline;

grant select, insert, update, delete on search_planner.plans to nabvy_pipeline;
select nabvy_core.allow_pipeline('search_planner.plans', 'all');
select nabvy_core.track_updated_at('search_planner.plans');

grant select, insert, update, delete on search_planner.plan_terms to nabvy_pipeline;
select nabvy_core.allow_pipeline('search_planner.plan_terms', 'all');
select nabvy_core.track_updated_at('search_planner.plan_terms');

grant select, insert, update on search_planner.one_off_runs to nabvy_pipeline;
select nabvy_core.allow_pipeline('search_planner.one_off_runs', 'select');
select nabvy_core.allow_pipeline('search_planner.one_off_runs', 'insert');
select nabvy_core.allow_pipeline('search_planner.one_off_runs', 'update');
select nabvy_core.track_updated_at('search_planner.one_off_runs');

-- Internal: the pairs that run, for check-scheduler (card, "Views"). One row per (centre, term)
-- of an active plan inside the budget bound; a pair wanted by active wants and also entered as
-- the admin test shows once, with both origins. Counts only, never a user ID. Empty while the
-- module is off (rule 11; card, "When off: no plan, so nothing is scheduled").
create view search_planner.v_plan with (security_invoker = true) as
select
  t.centre_id,
  t.term,
  min(t.class) as class,
  array_agg(t.origin order by t.origin) as origins,
  max(t.want_count)::integer as want_count,
  max(t.paid_want_count)::integer as paid_want_count,
  min(t.rank)::integer as rank
from search_planner.plan_terms t
join search_planner.plans p on p.centre_id = t.centre_id
where p.active
  and t.in_budget
  and switches.state('search-planner') <> 'off'
group by t.centre_id, t.term;
revoke all on search_planner.v_plan from public;
grant select on search_planner.v_plan to nabvy_pipeline;

-- Internal: every one-off run with whether it was approved, never who approved it (card,
-- "Views"). Empty while the module is off.
create view search_planner.v_one_off_runs with (security_invoker = true) as
select
  r.id,
  r.purpose,
  r.input,
  (r.approved_by is not null) as approved,
  r.status,
  r.created_at,
  r.updated_at
from search_planner.one_off_runs r
where switches.state('search-planner') <> 'off';
revoke all on search_planner.v_one_off_runs from public;
grant select on search_planner.v_one_off_runs to nabvy_pipeline;
