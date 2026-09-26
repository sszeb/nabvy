-- Access and views for the scan_lookup schema (packages/db/README.md, "Adding tables to a
-- module"; services/scan-lookup/README.md). Depends on core (track_updated_at) and switches
-- (switches.state, switches.is_on). `lookups` carries a user_id, unlike asking-price-index's
-- groups/stats, so it gets per-user RLS like usage-ledger's tables.
--
-- Only the pipeline role writes (nabvy_pipeline; per-module roles are question 2 of the
-- catalogue): lookup() runs inside withPipeline (it calls usage-ledger's chargeUsage and
-- account's isActive, both pipeline-only calls per their own READMEs). nabvy_app reads only its
-- own rows, through app.v_scan_lookup_results, while the module is on (rule 11) — never a bare
-- select on the table, so a future column here needs no new grant review each time.

grant usage on schema scan_lookup to nabvy_pipeline;
grant select, insert, update, delete on scan_lookup.lookups to nabvy_pipeline;
select nabvy_core.track_updated_at('scan_lookup.lookups');

-- Internal view: security_invoker, explicit columns, no seller field (none is stored). Empty
-- while the module's switch is off (rule 11).
create view scan_lookup.v_results with (security_invoker = true) as
select
  scan_id, user_id, catalogue_id, status, sources, bands, cost, latency_ms, at
from scan_lookup.lookups
where switches.state('scan-lookup') <> 'off';

revoke all on scan_lookup.v_results from public, anon, authenticated;
grant select on scan_lookup.v_results to nabvy_pipeline;

-- User-facing: the scan card data for the user (this module's card, "Views"). Own rows only, no
-- user_id column (the caller already knows whose scan it is), no seller field. `bands` is the
-- frozen snapshot `lookup()` wrote; asking-price-index rewriting its own stats later never moves
-- what this scan showed.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to nabvy_app;

create view app.v_scan_lookup_results with (security_invoker = true) as
select scan_id, catalogue_id, status, sources, bands, cost, latency_ms, at
from scan_lookup.lookups
where switches.is_on('scan-lookup');

revoke all on app.v_scan_lookup_results from public, anon, authenticated;
grant select on app.v_scan_lookup_results to nabvy_app;

-- The view is security_invoker, so nabvy_app needs these columns and row-level security on the
-- table itself (user_id is read by the policy, not selected by the view).
grant usage on schema scan_lookup to nabvy_app;
grant select (scan_id, user_id, catalogue_id, status, sources, bands, cost, latency_ms, at)
  on scan_lookup.lookups to nabvy_app;

alter table scan_lookup.lookups enable row level security;
create policy pipeline_all on scan_lookup.lookups for all to nabvy_pipeline
  using (true) with check (true);
create policy app_own_rows on scan_lookup.lookups for select to nabvy_app
  using (user_id = nabvy_core.current_user_id() and switches.is_on('scan-lookup'));
