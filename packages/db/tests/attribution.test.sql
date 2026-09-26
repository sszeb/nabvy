-- Attribution (services/attribution): grants, RLS isolation, the self-referral check constraint,
-- the append-only-but-purgeable partner_events guard, and the internal view's switch rule.
-- Rolled back.
begin;
set local client_min_messages = warning;

-- Grants: only the pipeline writes; nabvy_app reads only utm_attributions and referral_codes (own
-- row); referrals and partner_events are pipeline-only; no Data API role reaches the schema; the
-- view is pipeline-only.
do $$
declare
  t text;
begin
  foreach t in array array['attribution.utm_attributions', 'attribution.referral_codes'] loop
    if has_table_privilege('nabvy_app', t, 'insert') or has_table_privilege('nabvy_app', t, 'update')
       or has_table_privilege('nabvy_app', t, 'delete') then
      raise exception 'nabvy_app can write %', t;
    end if;
    if not has_table_privilege('nabvy_app', t, 'select') then
      raise exception 'nabvy_app cannot read %', t;
    end if;
  end loop;
  foreach t in array array['attribution.referrals', 'attribution.partner_events'] loop
    if has_table_privilege('nabvy_app', t, 'select') or has_table_privilege('nabvy_app', t, 'insert') then
      raise exception 'nabvy_app can reach %', t;
    end if;
  end loop;
  if has_table_privilege('nabvy_app', 'attribution.v_attributions', 'select')
     or not has_table_privilege('nabvy_pipeline', 'attribution.v_attributions', 'select') then
    raise exception 'v_attributions must be granted to nabvy_pipeline only';
  end if;
  if has_schema_privilege('anon', 'attribution', 'usage')
     or has_schema_privilege('authenticated', 'attribution', 'usage') then
    raise exception 'attribution is reachable by a Data API role';
  end if;
  if has_function_privilege('nabvy_app', 'attribution.refuse_partner_event_change()', 'execute')
     or has_function_privilege('nabvy_pipeline', 'attribution.refuse_partner_event_change()', 'execute') then
    raise exception 'the trigger function is executable by an application role';
  end if;
  if exists (select 1 from nabvy_core.view_violations() where view_name like 'attribution.%') then
    raise exception 'attribution views break the view conventions';
  end if;
end;
$$;

-- Two users, captured by the pipeline: a referral pair, and a Dub-attributed lead.
set local role nabvy_pipeline;
insert into attribution.utm_attributions (user_id, affiliate_click_id, affiliate_partner_id) values
  ('00000000-0000-4000-8000-0000000000d1', null, null),
  ('00000000-0000-4000-8000-0000000000d2', 'click_d2', 'partner_d2');
insert into attribution.referral_codes (user_id, code) values
  ('00000000-0000-4000-8000-0000000000d1', 'ABCDEFGH'),
  ('00000000-0000-4000-8000-0000000000d2', 'JKLMNPQR');
insert into attribution.referrals (referrer_user_id, referred_user_id, code) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2', 'ABCDEFGH');
insert into attribution.partner_events (user_id, kind, ref_id, partner_id) values
  ('00000000-0000-4000-8000-0000000000d2', 'lead', 'signup', 'partner_d2');
reset role;

-- A referral code is unique; a referred user has one referrer; self-referral is refused.
do $$
begin
  begin
    set local role nabvy_pipeline;
    insert into attribution.referral_codes (user_id, code)
    values ('00000000-0000-4000-8000-0000000000d3', 'ABCDEFGH');
    raise exception 'a duplicate referral code was accepted';
  exception when unique_violation then
    null;
  end;
  begin
    insert into attribution.referrals (referrer_user_id, referred_user_id, code)
    values ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000d2', 'X');
    raise exception 'a second referrer for an already-referred user was accepted';
  exception when unique_violation then
    null;
  end;
  begin
    insert into attribution.referrals (referrer_user_id, referred_user_id, code)
    values ('00000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000d4', 'X');
    raise exception 'a self-referral was accepted';
  exception when check_violation then
    null;
  end;
  reset role;
end;
$$;

-- partner_events rows are never edited or truncated, but the pipeline may delete for a purge.
do $$
begin
  begin
    set local role nabvy_pipeline;
    update attribution.partner_events set partner_id = 'other' where ref_id = 'signup';
    raise exception 'a partner event was updated';
  exception when insufficient_privilege then
    null;
  end;
  begin
    truncate attribution.partner_events;
    raise exception 'partner_events was truncated';
  exception when insufficient_privilege then
    null;
  end;
  delete from attribution.partner_events where user_id = '00000000-0000-4000-8000-0000000000d2';
  if exists (select 1 from attribution.partner_events where user_id = '00000000-0000-4000-8000-0000000000d2') then
    raise exception 'the pipeline could not delete a partner event for the purge';
  end if;
  insert into attribution.partner_events (user_id, kind, ref_id, partner_id) values
    ('00000000-0000-4000-8000-0000000000d2', 'lead', 'signup', 'partner_d2');
  reset role;
end;
$$;

-- nabvy_app as d1: sees only its own utm_attributions and referral_codes rows; nothing without
-- withUser; never reaches referrals or partner_events.
set local role nabvy_app;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000d1', true);
do $$
begin
  if (select count(*) from attribution.utm_attributions) <> 1
     or (select affiliate_click_id from attribution.utm_attributions) is not null then
    raise exception 'nabvy_app sees another user''s utm_attributions row';
  end if;
  if (select code from attribution.referral_codes) <> 'ABCDEFGH' then
    raise exception 'nabvy_app does not see its own referral code';
  end if;
  begin
    perform 1 from attribution.referrals;
    raise exception 'nabvy_app read referrals';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform 1 from attribution.partner_events;
    raise exception 'nabvy_app read partner_events';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
select set_config('app.user_id', '', true);
do $$
begin
  if exists (select 1 from attribution.utm_attributions) then
    raise exception 'nabvy_app reads utm_attributions without withUser';
  end if;
end;
$$;
reset role;

-- Switch rule: v_attributions has no rows while off (the default in this test); shadow shows rows.
set local role nabvy_pipeline;
do $$
begin
  if switches.state('attribution') <> 'off' then
    raise exception 'attribution should default to off in this test';
  end if;
  if exists (select 1 from attribution.v_attributions) then
    raise exception 'v_attributions shows rows while attribution is off';
  end if;
end;
$$;
reset role;
insert into switches.switches (name, kind, state) values ('attribution', 'module', 'shadow')
  on conflict (name) do update set state = excluded.state;
set local role nabvy_pipeline;
do $$
declare
  d1 record;
  d2 record;
begin
  select * into d1 from attribution.v_attributions where user_id = '00000000-0000-4000-8000-0000000000d1';
  select * into d2 from attribution.v_attributions where user_id = '00000000-0000-4000-8000-0000000000d2';
  if d1.referral_code <> 'ABCDEFGH' or d1.referred_by is not null then
    raise exception 'v_attributions is wrong for d1: %', d1;
  end if;
  if d2.referred_by <> '00000000-0000-4000-8000-0000000000d1' or d2.affiliate_partner_id <> 'partner_d2' then
    raise exception 'v_attributions is wrong for d2: %', d2;
  end if;
  if (select count(*) from attribution.v_attributions) <> 2 then
    raise exception 'v_attributions row count is wrong';
  end if;
end;
$$;
reset role;

rollback;
