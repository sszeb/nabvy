-- asking-price-index (services/asking-price-index): only the pipeline writes the tables; the
-- internal views are empty while the switch is off; the user-facing band view has exactly its
-- allowed columns, shows only n >= 10, and returns no rows while listing-suppression is off; and
-- nabvy_app can read neither the thin mark nor members (rules 5 and 11). Rolled back.
begin;
set local client_min_messages = warning;

do $$
begin
  if has_schema_privilege('anon', 'asking_price_index', 'usage')
     or has_schema_privilege('authenticated', 'asking_price_index', 'usage') then
    raise exception 'asking_price_index is reachable by a Data API role';
  end if;
  if exists (select 1 from nabvy_core.view_violations()
             where view_name like 'asking_price_index.%' or view_name like 'app.v_asking_price_index%') then
    raise exception 'asking_price_index views break the view conventions';
  end if;
  if has_table_privilege('nabvy_app', 'asking_price_index.members', 'select')
     or has_column_privilege('nabvy_app', 'asking_price_index.stats', 'thin', 'select')
     or has_table_privilege('nabvy_app', 'asking_price_index.groups', 'insert') then
    raise exception 'nabvy_app reaches more than the band columns';
  end if;
  if (select array_agg(column_name::text order by ordinal_position)
        from information_schema.columns
       where table_schema = 'app' and table_name = 'v_asking_price_index_bands')
     <> array['group_key', 'label', 'n', 'median', 'range_low', 'range_high', 'currency'] then
    raise exception 'app.v_asking_price_index_bands has other columns than allowed';
  end if;
  if not has_table_privilege('nabvy_app', 'app.v_asking_price_index_bands', 'select') then
    raise exception 'nabvy_app cannot read the bands';
  end if;
end;
$$;

insert into switches.switches (name, kind, state) values
  ('asking-price-index', 'module', 'on'), ('listing-suppression', 'module', 'on')
on conflict (name) do update set state = excluded.state;

insert into asking_price_index.groups
  (group_key, catalogue_id, context, condition, country, currency, window_days, label)
values
  ('gpu:rtx-3090|standalone|used_good|GB|GBP|30d', 'gpu:rtx-3090', 'standalone', 'used_good', 'GB', 'GBP', 30, 'RTX 3090'),
  ('gpu:rtx-3080|standalone|used_good|GB|GBP|30d', 'gpu:rtx-3080', 'standalone', 'used_good', 'GB', 'GBP', 30, 'RTX 3080');
insert into asking_price_index.stats (group_key, n, median, mad, p25, p75, min, max, thin, copy_collapse, as_of)
values
  ('gpu:rtx-3090|standalone|used_good|GB|GBP|30d', 10, 60000, 1000, 59000, 61000, 55000, 65000, false, true, now()),
  ('gpu:rtx-3080|standalone|used_good|GB|GBP|30d', 9, 40000, 1000, 39000, 41000, 35000, 45000, false, true, now());

set local role nabvy_app;
do $$
begin
  if (select count(*) from app.v_asking_price_index_bands) <> 1 then
    raise exception 'bands must show only groups with n >= 10';
  end if;
end;
$$;
reset role;

update switches.switches set state = 'off' where name = 'listing-suppression';
set local role nabvy_app;
do $$
begin
  if exists (select 1 from app.v_asking_price_index_bands) then
    raise exception 'bands must be empty while listing-suppression is off';
  end if;
end;
$$;
reset role;

update switches.switches set state = 'off' where name = 'asking-price-index';
set local role nabvy_pipeline;
do $$
begin
  if exists (select 1 from asking_price_index.v_groups)
     or exists (select 1 from asking_price_index.v_group_health) then
    raise exception 'internal views must be empty while the switch is off';
  end if;
end;
$$;
reset role;

rollback;
