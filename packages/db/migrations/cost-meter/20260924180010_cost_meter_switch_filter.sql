-- cost-meter: the switches module now exists (task 0.11), so v_costs filters by the live switch
-- instead of leaving that to readCosts() alone. Same columns as the original view
-- (services/cost-meter/README.md); CREATE OR REPLACE VIEW keeps its grants for an unchanged
-- column list.
create or replace view cost_meter.v_costs with (security_invoker = true) as
  select id, module, provider, kind, ref_id, currency,
         reserved_micros, settled_micros, reserved_gbp_micros, settled_gbp_micros,
         coalesce(settled_gbp_micros, reserved_gbp_micros) as counted_gbp_micros,
         status, latency_ms, settled_at, at
  from cost_meter.provider_calls
  where switches.state('cost-meter') <> 'off';
grant select on cost_meter.v_costs to nabvy_pipeline;
