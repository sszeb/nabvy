-- Subscriptions (services/subscriptions): grants, RLS isolation, append-only billing events, the
-- two internal views with their switch rules, and v_billing_signals never reaching a user-facing
-- view. Rolled back.
begin;
set local client_min_messages = warning;

-- Grants: only the pipeline writes; nabvy_app reads nothing but its own entitlement and customer
-- link; no Data API role reaches the schema; both views are pipeline-only.
do $$
declare
  t text;
begin
  foreach t in array array['subscriptions.entitlements', 'subscriptions.customers', 'subscriptions.billing_events'] loop
    if has_table_privilege('nabvy_app', t, 'insert') or has_table_privilege('nabvy_app', t, 'update')
       or has_table_privilege('nabvy_app', t, 'delete') then
      raise exception 'nabvy_app can write %', t;
    end if;
  end loop;
  if has_table_privilege('nabvy_app', 'subscriptions.billing_events', 'select') then
    raise exception 'nabvy_app can read billing_events';
  end if;
  if has_table_privilege('nabvy_pipeline', 'subscriptions.billing_events', 'update')
     or has_table_privilege('nabvy_pipeline', 'subscriptions.billing_events', 'delete')
     or has_table_privilege('nabvy_pipeline', 'subscriptions.customers', 'update') then
    raise exception 'billing_events or customers is changeable by the pipeline';
  end if;
  if has_schema_privilege('anon', 'subscriptions', 'usage')
     or has_schema_privilege('authenticated', 'subscriptions', 'usage') then
    raise exception 'subscriptions is reachable by a Data API role';
  end if;
  foreach t in array array['subscriptions.v_entitlements', 'subscriptions.v_billing_signals'] loop
    if has_table_privilege('nabvy_app', t, 'select') or not has_table_privilege('nabvy_pipeline', t, 'select') then
      raise exception '% must be granted to nabvy_pipeline only', t;
    end if;
  end loop;
  if has_function_privilege('nabvy_app', 'subscriptions.refuse_billing_event_change()', 'execute')
     or has_function_privilege('nabvy_pipeline', 'subscriptions.refuse_billing_event_change()', 'execute') then
    raise exception 'the trigger function is executable by an application role';
  end if;
  if exists (select 1 from nabvy_core.view_violations() where view_name like 'subscriptions.%') then
    raise exception 'subscriptions views break the view conventions';
  end if;
end;
$$;

-- v_billing_signals never reaches a user-facing view: no view outside this schema reads it, and
-- nothing nabvy_app can select depends on it.
do $$
begin
  if exists (
    select 1
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class v on v.oid = r.ev_class
    join pg_namespace n on n.oid = v.relnamespace
    where d.refobjid = 'subscriptions.v_billing_signals'::regclass
      and v.oid <> 'subscriptions.v_billing_signals'::regclass
      and (n.nspname <> 'subscriptions' or has_table_privilege('nabvy_app', v.oid, 'select'))
  ) then
    raise exception 'v_billing_signals is read by a view outside subscriptions or one nabvy_app can select';
  end if;
end;
$$;

-- Two users, written by the pipeline: an entitlement each, a card fingerprint and a dispute.
set local role nabvy_pipeline;
insert into subscriptions.entitlements
  (user_id, tier, status, areas, wants, channels, last_event_id, last_event_at)
values
  ('00000000-0000-4000-8000-0000000000d1', 'pro', 'active', 3, 20, '{telegram,email}', 'evt_d1', now()),
  ('00000000-0000-4000-8000-0000000000d2', 'free', 'free', 1, 1, '{telegram}', 'evt_d2', now());
insert into subscriptions.customers (stripe_customer_id, user_id) values
  ('cus_d1', '00000000-0000-4000-8000-0000000000d1');
insert into subscriptions.billing_events
  (stripe_event_id, type, stripe_object_id, user_id, outcome, stripe_created_at, card_fingerprint)
values ('evt_ch_d1', 'charge.succeeded', 'ch_d1', '00000000-0000-4000-8000-0000000000d1', 'recorded', now(), 'fp_d1');
insert into subscriptions.billing_events
  (stripe_event_id, type, stripe_object_id, user_id, outcome, stripe_created_at, signal)
values ('evt_dp_d1', 'charge.dispute.created', 'dp_d1', '00000000-0000-4000-8000-0000000000d1', 'recorded', now(), 'dispute');
reset role;

-- One row per Stripe event ID: a replay is refused by the unique key.
do $$
begin
  begin
    set local role nabvy_pipeline;
    insert into subscriptions.billing_events (stripe_event_id, type, outcome, stripe_created_at)
    values ('evt_ch_d1', 'charge.succeeded', 'recorded', now());
    raise exception 'a replayed event ID was accepted';
  exception when unique_violation then
    null;
  end;
  reset role;
end;
$$;

-- Consent is all-or-nothing with its Checkout session.
do $$
begin
  begin
    set local role nabvy_pipeline;
    insert into subscriptions.billing_events (stripe_event_id, type, outcome, stripe_created_at, checkout_session_id)
    values ('evt_cs_bad', 'checkout.session.completed', 'recorded', now(), 'cs_bad');
    raise exception 'a Checkout session without its consent was accepted';
  exception when check_violation then
    null;
  end;
  reset role;
end;
$$;

-- billing_events is append-only, even for the owner.
do $$
begin
  begin
    update subscriptions.billing_events set signal = null where stripe_event_id = 'evt_dp_d1';
    raise exception 'a billing event was updated';
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from subscriptions.billing_events where stripe_event_id = 'evt_dp_d1';
    raise exception 'a billing event was deleted';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

-- nabvy_app as d1: sees only its own entitlement and customer link; nothing without withUser.
set local role nabvy_app;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000d1', true);
do $$
begin
  if (select count(*) from subscriptions.entitlements) <> 1
     or (select tier from subscriptions.entitlements) <> 'pro' then
    raise exception 'nabvy_app sees another user''s entitlement';
  end if;
  if (select count(*) from subscriptions.customers) <> 1 then
    raise exception 'nabvy_app does not see exactly its own customer link';
  end if;
  begin
    perform 1 from subscriptions.v_billing_signals;
    raise exception 'nabvy_app read v_billing_signals';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
select set_config('app.user_id', '', true);
do $$
begin
  if exists (select 1 from subscriptions.entitlements) then
    raise exception 'nabvy_app reads entitlements without withUser';
  end if;
end;
$$;
reset role;

-- Switch rules: v_entitlements always has its rows (rule 11 exempts it); v_billing_signals has
-- none while the module is off.
set local role nabvy_pipeline;
do $$
begin
  if switches.state('subscriptions') <> 'off' then
    raise exception 'subscriptions should default to off in this test';
  end if;
  if (select count(*) from subscriptions.v_entitlements) <> 2 then
    raise exception 'v_entitlements is filtered by the switch';
  end if;
  if exists (select 1 from subscriptions.v_billing_signals) then
    raise exception 'v_billing_signals shows rows while subscriptions is off';
  end if;
end;
$$;
reset role;
insert into switches.switches (name, kind, state) values ('subscriptions', 'module', 'shadow')
  on conflict (name) do update set state = excluded.state;
set local role nabvy_pipeline;
do $$
declare
  s record;
begin
  select * into s from subscriptions.v_billing_signals;
  if s.user_id <> '00000000-0000-4000-8000-0000000000d1' or s.disputes <> 1
     or s.failed_payments <> 0 or s.card_fingerprints <> array['fp_d1'] then
    raise exception 'v_billing_signals is wrong: %', s;
  end if;
  if (select count(*) from subscriptions.v_billing_signals) <> 1 then
    raise exception 'v_billing_signals shows a user with no signal';
  end if;
end;
$$;
reset role;

rollback;
