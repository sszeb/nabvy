-- The usage ledger (services/usage-ledger): grants, RLS isolation, the triggers that keep buckets
-- in step with the ledger, and v_balances with its switch filter. Rolled back.
begin;
set local client_min_messages = warning;

-- Grants: nobody updates the ledger or writes buckets; nabvy_app never deletes; no Data API role
-- reaches the schema; the trigger functions are not callable by the application roles.
do $$
declare
  t text;
begin
  foreach t in array array['usage_ledger.entries', 'usage_ledger.buckets', 'usage_ledger.allocations'] loop
    if has_table_privilege('nabvy_app', t, 'update') or has_table_privilege('nabvy_pipeline', t, 'update') then
      raise exception '% is updatable by an application role', t;
    end if;
    if has_table_privilege('nabvy_app', t, 'delete') then
      raise exception 'nabvy_app can delete from %', t;
    end if;
  end loop;
  if has_table_privilege('nabvy_app', 'usage_ledger.buckets', 'insert')
     or has_table_privilege('nabvy_pipeline', 'usage_ledger.buckets', 'insert') then
    raise exception 'buckets are writable by an application role';
  end if;
  if has_schema_privilege('anon', 'usage_ledger', 'usage')
     or has_schema_privilege('authenticated', 'usage_ledger', 'usage') then
    raise exception 'usage_ledger is reachable by a Data API role';
  end if;
  if has_table_privilege('nabvy_app', 'usage_ledger.v_balances', 'select')
     or not has_table_privilege('nabvy_pipeline', 'usage_ledger.v_balances', 'select') then
    raise exception 'v_balances must be granted to nabvy_pipeline only';
  end if;
  if has_function_privilege('nabvy_app', 'usage_ledger.on_allocation_insert()', 'execute')
     or has_function_privilege('nabvy_pipeline', 'usage_ledger.on_entry_insert()', 'execute') then
    raise exception 'a trigger function is executable by an application role';
  end if;
  if exists (select 1 from nabvy_core.view_violations() where view_name like 'usage_ledger.%') then
    raise exception 'usage_ledger views break the view conventions';
  end if;
end;
$$;

-- Two users with a top-up each, granted by the pipeline; each grant opens its bucket.
set local role nabvy_pipeline;
insert into usage_ledger.entries (user_id, kind, credits, ref_id, cash_minor) values
  ('00000000-0000-4000-8000-0000000000b1', 'topup', 100, 'pi_b1', 1000),
  ('00000000-0000-4000-8000-0000000000b2', 'topup', 100, 'pi_b2', 1000);
reset role;
do $$
begin
  if (select count(*) from usage_ledger.buckets where remaining = 100 and rank = 3) <> 2 then
    raise exception 'a grant did not open its bucket';
  end if;
end;
$$;

-- nabvy_app as b1: sees only its own rows, cannot grant, cannot write for b2, and a charge with
-- its allocation moves the bucket.
set local role nabvy_app;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000b1', true);
do $$
declare
  refused boolean;
  probe text;
  charge_id uuid;
begin
  if (select count(*) from usage_ledger.buckets) <> 1 or (select count(*) from usage_ledger.entries) <> 1 then
    raise exception 'nabvy_app sees another user''s ledger';
  end if;
  foreach probe in array array[
    $q$insert into usage_ledger.entries (user_id, kind, credits, ref_id) values ('00000000-0000-4000-8000-0000000000b1', 'topup', 1000, 'mint')$q$,
    $q$insert into usage_ledger.entries (user_id, kind, credits, action, ref_id) values ('00000000-0000-4000-8000-0000000000b2', 'charge', 0, 'x', 'other')$q$
  ] loop
    refused := false;
    begin
      execute probe;
    exception when insufficient_privilege then
      refused := true;
    end;
    if not refused then
      raise exception 'not refused: %', probe;
    end if;
  end loop;

  insert into usage_ledger.entries (user_id, kind, credits, action, ref_id)
    values ('00000000-0000-4000-8000-0000000000b1', 'charge', -30, 'scan_live', 'scan:1')
    returning id into charge_id;
  insert into usage_ledger.allocations (entry_id, bucket_id, user_id, credits)
    select charge_id, b.id, b.user_id, -30 from usage_ledger.buckets as b;
  if (select remaining from usage_ledger.buckets) <> 70 then
    raise exception 'the allocation did not move the bucket';
  end if;

  -- An overdraw is refused by the bucket's check constraint.
  refused := false;
  begin
    insert into usage_ledger.entries (user_id, kind, credits, action, ref_id)
      values ('00000000-0000-4000-8000-0000000000b1', 'charge', -71, 'scan_live', 'scan:over')
      returning id into charge_id;
    insert into usage_ledger.allocations (entry_id, bucket_id, user_id, credits)
      select charge_id, b.id, b.user_id, -71 from usage_ledger.buckets as b;
  exception when check_violation then
    refused := true;
  end;
  if not refused then
    raise exception 'an overdraw was accepted';
  end if;

  -- A charge whose allocations do not add up is refused at commit (forced here).
  refused := false;
  begin
    insert into usage_ledger.entries (user_id, kind, credits, action, ref_id)
      values ('00000000-0000-4000-8000-0000000000b1', 'charge', -5, 'scan_live', 'scan:bare');
    set constraints all immediate;
  exception when check_violation then
    refused := true;
  end;
  set constraints all deferred;
  if not refused then
    raise exception 'a charge without allocations was accepted';
  end if;
end;
$$;
reset role;

-- A reversal returns exactly what its charge took, once.
set local role nabvy_app;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000b1', true);
do $$
declare
  charge_id uuid := (select id from usage_ledger.entries where ref_id = 'scan:1' and kind = 'charge');
  reversal_id uuid;
  refused boolean := false;
begin
  begin
    insert into usage_ledger.entries (user_id, kind, credits, ref_id, reverses_id)
      values ('00000000-0000-4000-8000-0000000000b1', 'reversal', 31, 'scan:1', charge_id);
  exception when check_violation then
    refused := true;
  end;
  if not refused then
    raise exception 'a reversal returning more than its charge was accepted';
  end if;
  insert into usage_ledger.entries (user_id, kind, credits, ref_id, reverses_id)
    values ('00000000-0000-4000-8000-0000000000b1', 'reversal', 30, 'scan:1', charge_id)
    returning id into reversal_id;
  insert into usage_ledger.allocations (entry_id, bucket_id, user_id, credits)
    select reversal_id, a.bucket_id, a.user_id, -a.credits from usage_ledger.allocations as a
    where a.entry_id = charge_id;
  if (select remaining from usage_ledger.buckets) <> 100 then
    raise exception 'the reversal did not restore the bucket';
  end if;
  refused := false;
  begin
    insert into usage_ledger.entries (user_id, kind, credits, ref_id, reverses_id)
      values ('00000000-0000-4000-8000-0000000000b1', 'reversal', 30, 'scan:1-again', charge_id);
  exception when unique_violation then
    refused := true;
  end;
  if not refused then
    raise exception 'a charge was reversed twice';
  end if;
end;
$$;
reset role;

-- v_balances: no rows while the module is off (no seed row reads off), rows once it is on;
-- an expired bucket counts nothing.
set local role nabvy_pipeline;
insert into usage_ledger.entries (user_id, kind, credits, ref_id, expires_at) values
  ('00000000-0000-4000-8000-0000000000b2', 'allowance', 50, 'allowance:old', now() - interval '1 hour');
do $$
begin
  if exists (select 1 from usage_ledger.v_balances) then
    raise exception 'v_balances shows rows while usage-ledger is off';
  end if;
end;
$$;
reset role;
insert into switches.switches (name, kind, state) values ('usage-ledger', 'module', 'on')
  on conflict (name) do update set state = excluded.state;
set local role nabvy_pipeline;
do $$
begin
  if (select credits from usage_ledger.v_balances where user_id = '00000000-0000-4000-8000-0000000000b2') <> 100 then
    raise exception 'v_balances counts an expired bucket';
  end if;
  if (select credits from usage_ledger.v_balances where user_id = '00000000-0000-4000-8000-0000000000b1') <> 100 then
    raise exception 'v_balances is wrong after a reversal';
  end if;
end;
$$;
reset role;

-- A charge may not draw on an expired bucket, whoever writes it (allocation guards migration).
set local role nabvy_pipeline;
do $$
declare
  refused boolean := false;
  charge_id uuid;
begin
  begin
    insert into usage_ledger.entries (user_id, kind, credits, action, ref_id)
      values ('00000000-0000-4000-8000-0000000000b2', 'charge', -1, 'scan_live', 'scan:expired')
      returning id into charge_id;
    insert into usage_ledger.allocations (entry_id, bucket_id, user_id, credits)
      select charge_id, e.id, e.user_id, -1 from usage_ledger.entries as e
      where e.ref_id = 'allowance:old';
  exception when check_violation then
    refused := true;
  end;
  if not refused then
    raise exception 'a charge drew on an expired bucket';
  end if;
end;
$$;
reset role;

rollback;
