-- The cost-meter ledger (services/cost-meter): who may use it, idempotency on (provider, ref_id),
-- the settle-once guard and v_costs. Rolled back.
begin;
set local client_min_messages = warning;

-- Only the pipeline reaches the schema: never nabvy_app, anon or authenticated; no deletes.
do $$
begin
  if not has_table_privilege('nabvy_pipeline', 'cost_meter.provider_calls', 'select,insert,update') then
    raise exception 'nabvy_pipeline cannot record and settle calls';
  end if;
  if has_table_privilege('nabvy_pipeline', 'cost_meter.provider_calls', 'delete') then
    raise exception 'nabvy_pipeline can delete ledger rows';
  end if;
  if has_schema_privilege('nabvy_app', 'cost_meter', 'usage')
     or has_schema_privilege('anon', 'cost_meter', 'usage')
     or has_schema_privilege('authenticated', 'cost_meter', 'usage') then
    raise exception 'cost_meter is reachable by a role other than nabvy_pipeline';
  end if;
  if not has_table_privilege('nabvy_pipeline', 'cost_meter.v_costs', 'select') then
    raise exception 'nabvy_pipeline cannot read v_costs';
  end if;
  if has_function_privilege('nabvy_pipeline', 'cost_meter.guard_provider_call()', 'execute') then
    raise exception 'the guard trigger function is executable by the pipeline';
  end if;
end;
$$;

set local role nabvy_pipeline;

-- A reservation for the recorded run, then the same (provider, ref_id) again: one row.
insert into cost_meter.provider_calls
  (module, provider, kind, ref_id, currency, reserved_micros, usd_gbp_rate, reserved_gbp_micros, status, at)
values
  ('apify-gateway', 'apify', 'actor_run', 'VkryjpwS6U2GBDh3k', 'USD', 336300, 0.75, 252225, 'pending', '2026-09-24T01:40:18.718Z');
insert into cost_meter.provider_calls
  (module, provider, kind, ref_id, currency, reserved_micros, usd_gbp_rate, reserved_gbp_micros, status, at)
values
  ('apify-gateway', 'apify', 'actor_run', 'VkryjpwS6U2GBDh3k', 'USD', 336300, 0.75, 252225, 'pending', '2026-09-24T01:40:18.718Z')
on conflict (provider, ref_id) do nothing;

do $$
begin
  if (select count(*) from cost_meter.provider_calls) <> 1 then
    raise exception 'a replayed record wrote a second row';
  end if;
  if (select counted_gbp_micros from cost_meter.v_costs) <> 252225 then
    raise exception 'an unsettled call must count at its reservation';
  end if;
end;
$$;

-- The settlement replaces the reservation.
update cost_meter.provider_calls
set settled_micros = 17700, settled_gbp_micros = 13275, settled_at = '2026-09-24T01:50:44.010Z',
    status = 'succeeded'
where ref_id = 'VkryjpwS6U2GBDh3k' and settled_at is null;

do $$
begin
  if (select counted_gbp_micros from cost_meter.v_costs) <> 13275 then
    raise exception 'a settled call must count at its settlement';
  end if;
  -- Once only: a second settlement is refused by the guard.
  begin
    update cost_meter.provider_calls set settled_micros = 293, settled_gbp_micros = 220;
    raise exception 'a second settlement was accepted';
  exception when check_violation then null;
  end;
  -- A reservation never changes.
  begin
    update cost_meter.provider_calls set reserved_micros = 1;
    raise exception 'a reservation was changed';
  exception when check_violation then null;
  end;
  -- Half a settlement is refused.
  begin
    insert into cost_meter.provider_calls
      (module, provider, kind, ref_id, currency, reserved_micros, usd_gbp_rate, reserved_gbp_micros,
       settled_micros, status, at)
    values ('apify-gateway', 'apify', 'actor_run', 'half', 'USD', 1, 0.75, 1, 1, 'pending', now());
    raise exception 'a settlement without settled_at was accepted';
  exception when check_violation then null;
  end;
end;
$$;

reset role;

-- v_costs meets the view rules (security_invoker; no seller or raw columns).
do $$
begin
  if exists (select 1 from nabvy_core.view_violations() where view_name like 'cost_meter.%') then
    raise exception 'cost_meter views break the view rules';
  end if;
end;
$$;

rollback;
