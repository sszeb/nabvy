-- The pricing console (services/pricing-console): grants, row-level security on offers, the
-- append-only guard, the seeded initial policy, the views and v_offers' switch filter, and the
-- measured-cost reader. Rolled back.
begin;
set local client_min_messages = warning;

-- Grants: only the pipeline writes; nobody updates; the web app only reads the table (through
-- RLS) and runs the measured-cost reader; the views are the pipeline's; no Data API role reaches
-- the schema; every view is security_invoker.
do $$
begin
  if has_table_privilege('nabvy_app', 'pricing_console.policy_rows', 'insert')
     or has_table_privilege('nabvy_app', 'pricing_console.policy_rows', 'delete')
     or has_table_privilege('nabvy_app', 'pricing_console.policy_rows', 'update')
     or has_table_privilege('nabvy_pipeline', 'pricing_console.policy_rows', 'update') then
    raise exception 'policy_rows is writable beyond the pipeline''s insert and delete';
  end if;
  if not has_table_privilege('nabvy_pipeline', 'pricing_console.policy_rows', 'insert')
     or not has_table_privilege('nabvy_app', 'pricing_console.policy_rows', 'select') then
    raise exception 'policy_rows grants are missing';
  end if;
  if has_schema_privilege('anon', 'pricing_console', 'usage')
     or has_schema_privilege('authenticated', 'pricing_console', 'usage') then
    raise exception 'pricing_console is reachable by a Data API role';
  end if;
  if has_table_privilege('nabvy_app', 'pricing_console.v_ladder', 'select')
     or has_table_privilege('nabvy_app', 'pricing_console.v_offers', 'select')
     or not has_table_privilege('nabvy_pipeline', 'pricing_console.v_ladder', 'select')
     or not has_table_privilege('nabvy_pipeline', 'pricing_console.v_prices', 'select')
     or not has_table_privilege('nabvy_pipeline', 'pricing_console.v_offers', 'select')
     or not has_table_privilege('nabvy_pipeline', 'pricing_console.v_free_policy', 'select')
     or not has_table_privilege('nabvy_pipeline', 'pricing_console.v_settings', 'select') then
    raise exception 'the v_ views must be granted to nabvy_pipeline only';
  end if;
  if not has_function_privilege('nabvy_app', 'pricing_console.measured_cost(text, text, integer, integer)', 'execute')
     or has_function_privilege('anon', 'pricing_console.measured_cost(text, text, integer, integer)', 'execute') then
    raise exception 'measured_cost grants are wrong';
  end if;
  if exists (select 1 from nabvy_core.view_violations() where view_name like 'pricing_console.%') then
    raise exception 'pricing_console views break the view conventions';
  end if;
end;
$$;

-- The seeded initial policy: four tiers on the ladder, eleven prices, five settings, the free
-- tier. Every view but v_offers publishes while the module is off (no switch row: off).
do $$
begin
  if (select count(*) from pricing_console.v_ladder) <> 4
     or (select count(*) from pricing_console.v_prices) <> 11
     or (select count(*) from pricing_console.v_settings) <> 5
     or (select count(*) from pricing_console.v_free_policy) <> 1 then
    raise exception 'the seeded policy is not all published';
  end if;
  if (select base_cadence_minutes from pricing_console.v_ladder where tier = 'pro') <> 30
     or (select floor_cadence_minutes from pricing_console.v_ladder where tier = 'pro') <> 5 then
    raise exception 'Pro is not 30 minutes base, 5 minutes floor (owner, Paid ladder)';
  end if;
end;
$$;

-- Offers: one for user b1, one for everyone. v_offers is empty while the module is off.
set local role nabvy_pipeline;
insert into pricing_console.policy_rows (kind, key, version, value, target_user_id) values
  ('offer', 'for-b1', 1,
   jsonb_build_object('userId', '00000000-0000-4000-8000-0000000000b1', 'segment', null,
     'item', 'price:export', 'discountBps', 1000,
     'startsAt', now() - interval '1 minute', 'endsAt', now() + interval '1 hour'),
   '00000000-0000-4000-8000-0000000000b1'),
  ('offer', 'for-all', 1,
   jsonb_build_object('userId', null, 'segment', 'all', 'item', 'price:export', 'discountBps', 500,
     'startsAt', now() - interval '1 minute', 'endsAt', now() + interval '1 hour'),
   null);
reset role;
do $$
begin
  if exists (select 1 from pricing_console.v_offers) then
    raise exception 'v_offers has rows while pricing-console is off';
  end if;
end;
$$;
insert into switches.switches (name, kind, state) values ('pricing-console', 'module', 'on')
  on conflict (name) do update set state = 'on';
do $$
begin
  if (select count(*) from pricing_console.v_offers) <> 2 then
    raise exception 'v_offers does not show live offers while on';
  end if;
end;
$$;

-- RLS: b2 sees the offer for everyone, not b1's; b1 sees both.
set local role nabvy_app;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000b2', true);
do $$
begin
  if (select count(*) from pricing_console.policy_rows where kind = 'offer') <> 1 then
    raise exception 'another user''s offer is visible to the web app';
  end if;
end;
$$;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000b1', true);
do $$
begin
  if (select count(*) from pricing_console.policy_rows where kind = 'offer') <> 2 then
    raise exception 'a user''s own offer is hidden from them';
  end if;
end;
$$;
reset role;

-- Append-only: no update, no delete of anything but a user's offer, no gaps, nothing effective
-- in the past, a target only on offers and matching the offer.
do $$
declare
  refused boolean;
begin
  refused := false;
  begin
    update pricing_console.policy_rows set reason = 'x' where kind = 'tier';
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'a policy row was updated'; end if;

  refused := false;
  begin
    delete from pricing_console.policy_rows where kind = 'price';
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'a price row was deleted'; end if;

  refused := false;
  begin
    insert into pricing_console.policy_rows (kind, key, version, value)
      values ('setting', 'vat-bps', 3, '{"value": 2000}');
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'a version gap was accepted'; end if;

  refused := false;
  begin
    insert into pricing_console.policy_rows (kind, key, version, value, effective_at)
      values ('setting', 'vat-bps', 2, '{"value": 2000}', now() - interval '1 hour');
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'a change took effect in the past'; end if;

  refused := false;
  begin
    insert into pricing_console.policy_rows (kind, key, version, value, target_user_id)
      values ('offer', 'forged', 1, '{"userId": null}', '00000000-0000-4000-8000-0000000000b2');
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'an offer''s target differs from its userId'; end if;
end;
$$;

-- A user's offer can be purged; a retired row hides its key from the views.
set local role nabvy_pipeline;
delete from pricing_console.policy_rows where target_user_id = '00000000-0000-4000-8000-0000000000b1';
insert into pricing_console.policy_rows (kind, key, version, value, retired)
  select 'price', 'boost-7d', 2, value, true from pricing_console.policy_rows
  where kind = 'price' and key = 'boost-7d' and version = 1;
reset role;
do $$
begin
  if exists (select 1 from pricing_console.v_prices where item = 'boost-7d') then
    raise exception 'a retired price is still published';
  end if;
  if (select count(*) from pricing_console.v_offers) <> 1 then
    raise exception 'the purged offer is still live';
  end if;
end;
$$;

-- Measured cost: null until enough calls, then their mean, rounded up.
insert into switches.switches (name, kind, state) values ('cost-meter', 'module', 'on')
  on conflict (name) do update set state = 'on';
insert into cost_meter.provider_calls
  (module, provider, kind, ref_id, currency, reserved_micros, usd_gbp_rate, reserved_gbp_micros, status, at)
  select 'apify-gateway', 'apify', 'actor_run', 'pc-test-' || g, 'GBP', 10001, 1, 10001, 'succeeded', now()
  from generate_series(1, 3) as g;
set local role nabvy_app;
do $$
begin
  if pricing_console.measured_cost('apify', null, 7, 4) is not null then
    raise exception 'measured_cost answered below its sample minimum';
  end if;
  if pricing_console.measured_cost('apify', null, 7, 3) <> 10001 then
    raise exception 'measured_cost is not the mean of the matching calls';
  end if;
end;
$$;
reset role;

rollback;
