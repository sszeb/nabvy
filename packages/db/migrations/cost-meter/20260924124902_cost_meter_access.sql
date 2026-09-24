-- Access, the settle-once guard and the v_costs view for the cost-meter module.
-- Hand-written (drizzle-kit --custom). services/cost-meter/README.md has the rules.

-- Only the pipeline uses the ledger: paying modules write through services/cost-meter, and
-- spend-governor and ops-metrics read v_costs. Never granted to anon or authenticated, and not to
-- nabvy_app: users never see provider costs.
grant usage on schema cost_meter to nabvy_pipeline;

-- The pipeline records and settles calls. No delete: the ledger is append-and-settle only.
grant select, insert, update on cost_meter.provider_calls to nabvy_pipeline;
select nabvy_core.allow_pipeline('cost_meter.provider_calls', 'select');
select nabvy_core.allow_pipeline('cost_meter.provider_calls', 'insert');
select nabvy_core.allow_pipeline('cost_meter.provider_calls', 'update');
select nabvy_core.track_updated_at('cost_meter.provider_calls');

-- A settlement replaces the reservation once. After settled_at is set, the settled amounts, the
-- rate and settled_at never change; what identifies a call (module, provider, kind, ref_id,
-- currency, at) and its reservation never change at all. Only status and latency may still move.
create or replace function cost_meter.guard_provider_call()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if (new.module, new.provider, new.kind, new.ref_id, new.currency, new.at,
      new.reserved_micros, new.reserved_gbp_micros)
     is distinct from
     (old.module, old.provider, old.kind, old.ref_id, old.currency, old.at,
      old.reserved_micros, old.reserved_gbp_micros) then
    raise exception 'cost_meter.provider_calls: a recorded call and its reservation never change'
      using errcode = 'check_violation';
  end if;
  if old.settled_at is not null
     and (new.settled_at, new.settled_micros, new.settled_gbp_micros, new.usd_gbp_rate)
         is distinct from
         (old.settled_at, old.settled_micros, old.settled_gbp_micros, old.usd_gbp_rate) then
    raise exception 'cost_meter.provider_calls: call % is already settled', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function cost_meter.guard_provider_call() from public;

create trigger provider_calls_guard
  before update on cost_meter.provider_calls
  for each row execute function cost_meter.guard_provider_call();

-- The ledger other modules read (CostMeterCall). counted_gbp_micros is what a call costs now:
-- its settlement once settled, otherwise its reservation.
-- STUB (switch): rule 11 hides internal rows while the module is off. The switches module is not
-- built yet, so this view cannot filter on switches.is_on('cost-meter'); services/cost-meter's
-- readCosts() applies the switch instead. When switches ships, a new migration adds
-- `where switches.state('cost-meter') <> 'off'` here with the same columns.
create view cost_meter.v_costs with (security_invoker = true) as
  select id, module, provider, kind, ref_id, currency,
         reserved_micros, settled_micros, reserved_gbp_micros, settled_gbp_micros,
         coalesce(settled_gbp_micros, reserved_gbp_micros) as counted_gbp_micros,
         status, latency_ms, settled_at, at
  from cost_meter.provider_calls;
grant select on cost_meter.v_costs to nabvy_pipeline;
