-- travel-cost: grants, RLS, internal view. Hand-written (packages/db/README.md).
comment on schema travel_cost is
  'Travel cost: dated HMRC-style rate rows and each user''s trip-cost settings. Owner: the travel-cost module.';
grant usage on schema travel_cost to nabvy_app, nabvy_pipeline;

-- travel_rates: reference data, no user_id, never written by an application role. New rows arrive
-- only through a future migration (services/travel-cost/README.md, "Job": the coordinator reviews
-- rates each quarter). Both roles read it directly for this module's own tripCost()/params(); other
-- modules read it only through v_rates below (rule 5 of docs/design/modules/_rules.md).
grant select on travel_cost.travel_rates to nabvy_app, nabvy_pipeline;

-- user_travel_settings: the user manages their own settings through withUser; the pipeline reads
-- across users for params()/tripCost() calls made from pipeline context (for example a
-- "Lowest price + trip" sort, or deal-hints' K calculation), the same allow_pipeline pattern
-- services/account uses for v_profiles.
grant select, insert, update, delete on travel_cost.user_travel_settings to nabvy_app;
select nabvy_core.enable_user_rls('travel_cost.user_travel_settings');
select nabvy_core.allow_pipeline('travel_cost.user_travel_settings', 'select');
grant select on travel_cost.user_travel_settings to nabvy_pipeline;
select nabvy_core.track_updated_at('travel_cost.user_travel_settings');

-- Internal view (rule 5): security_invoker so RLS applies to the caller (this table carries none,
-- but the convention is uniform), gated by the module's own switch like every internal view (rule
-- 11's table; travel_rates carries no exemption). Granted to nabvy_pipeline only until per-module
-- roles exist (packages/db/README.md, "One Postgres schema per module"; the same stand-in
-- switches and account use). No `app.*` view yet: no module has created the `app` schema
-- (services/account/README.md, "Decisions" records the same deferral); when the web app's oRPC
-- layer exists, its procedures call this module's exported `listRates()`/`params()`/`tripCost()`
-- directly (rule 12), rather than this module inventing the first `app.*` view ahead of that work.
create view travel_cost.v_rates with (security_invoker = true) as
  select kind, fuel, engine_band, tier, pence_amount, unit, effective_from, source_url
  from travel_cost.travel_rates
  where switches.state('travel-cost') <> 'off';
revoke all on travel_cost.v_rates from public;
grant select on travel_cost.v_rates to nabvy_pipeline;
