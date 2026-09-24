-- The spend governor (services/spend-governor): who may use it, the seeded budgets, and the
-- fail-closed throttle view. Rolled back.
begin;
set local client_min_messages = warning;

-- Only the pipeline reaches the schema; budgets are read-only to it; throttle rows are never deleted.
do $$
begin
  if not has_table_privilege('nabvy_pipeline', 'spend_governor.budgets', 'select') then
    raise exception 'nabvy_pipeline cannot read the budgets';
  end if;
  if has_table_privilege('nabvy_pipeline', 'spend_governor.budgets', 'insert')
     or has_table_privilege('nabvy_pipeline', 'spend_governor.budgets', 'update')
     or has_table_privilege('nabvy_pipeline', 'spend_governor.budgets', 'delete') then
    raise exception 'nabvy_pipeline can change a budget: budgets are set by migrations only';
  end if;
  if not has_table_privilege('nabvy_pipeline', 'spend_governor.throttle', 'select,insert,update') then
    raise exception 'nabvy_pipeline cannot write the throttle';
  end if;
  if has_table_privilege('nabvy_pipeline', 'spend_governor.throttle', 'delete') then
    raise exception 'nabvy_pipeline can delete throttle rows';
  end if;
  if has_schema_privilege('nabvy_app', 'spend_governor', 'usage')
     or has_schema_privilege('anon', 'spend_governor', 'usage')
     or has_schema_privilege('authenticated', 'spend_governor', 'usage') then
    raise exception 'spend_governor is reachable by a role other than nabvy_pipeline';
  end if;
  if not has_table_privilege('nabvy_pipeline', 'spend_governor.v_throttle', 'select')
     or not has_table_privilege('nabvy_pipeline', 'spend_governor.v_budgets', 'select') then
    raise exception 'nabvy_pipeline cannot read the views';
  end if;
end;
$$;

-- The owner's budgets, as seeded.
do $$
begin
  if (select array_agg(name || ':' || unit || ':' || limit_micros order by name)
      from spend_governor.budgets)
     <> array['apify-monthly:USD:150000000', 'apify-plan-usage:USD:85000000',
              'apify-residential-proxy:GB:10000000'] then
    raise exception 'the seeded budgets are not the owner''s';
  end if;
end;
$$;

-- Off (no switch row): every budget holds new work, and v_budgets is empty.
set local role nabvy_pipeline;
do $$
begin
  if exists (select 1 from spend_governor.v_throttle where level <> 'hold-new' or reason <> 'off')
     or (select count(*) from spend_governor.v_throttle) <> 3 then
    raise exception 'v_throttle must hold every budget while the module is off';
  end if;
  if exists (select 1 from spend_governor.v_budgets) then
    raise exception 'v_budgets must be empty while the module is off';
  end if;
end;
$$;
reset role;

insert into switches.switches (name, kind, state) values
  ('spend-governor', 'module', 'on'), ('cost-meter', 'module', 'on')
on conflict (name) do update set state = excluded.state;

set local role nabvy_pipeline;

-- On, never computed: still held.
do $$
begin
  if exists (select 1 from spend_governor.v_throttle where level <> 'hold-new' or reason <> 'never-computed') then
    raise exception 'a budget never computed must hold new work';
  end if;
end;
$$;

-- A fresh row reads its level; a stale one holds; an unmeasured one reads none.
insert into spend_governor.throttle
  (budget, level, since, period_start, committed_micros, forecast_micros, computed_at, valid_until)
values
  ('apify-monthly', 'slow-free', now(), date_trunc('month', now()), 120000000, 130000000, now(), now() + interval '1 hour'),
  ('apify-plan-usage', 'none', now(), date_trunc('month', now()), 1, 1, now() - interval '2 hours', now() - interval '1 hour'),
  ('apify-residential-proxy', 'none', now(), date_trunc('month', now()), null, null, now(), now() + interval '1 hour');

do $$
begin
  if (select array_agg(budget || ':' || level || ':' || reason order by budget) from spend_governor.v_throttle)
     <> array['apify-monthly:slow-free:computed', 'apify-plan-usage:hold-new:stale',
              'apify-residential-proxy:none:unmeasured'] then
    raise exception 'v_throttle levels are wrong: %',
      (select array_agg(budget || ':' || level || ':' || reason order by budget) from spend_governor.v_throttle);
  end if;
  if (select remaining_micros from spend_governor.v_budgets where name = 'apify-monthly') <> 30000000 then
    raise exception 'remaining must be limit minus committed';
  end if;
end;
$$;

-- A level outside the five is refused.
do $$
begin
  begin
    update spend_governor.throttle set level = 'panic' where budget = 'apify-monthly';
    raise exception 'an unknown level was accepted';
  exception when check_violation then null;
  end;
end;
$$;
reset role;

-- cost-meter off: every budget holds again.
update switches.switches set state = 'off' where name = 'cost-meter';
set local role nabvy_pipeline;
do $$
begin
  if exists (select 1 from spend_governor.v_throttle where level <> 'hold-new' or reason <> 'off') then
    raise exception 'v_throttle must hold every budget while cost-meter is off';
  end if;
end;
$$;

rollback;
