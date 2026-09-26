-- inventory (services/inventory): grants, column-level update, RLS isolation between users
-- (cross-user select, update and insert), the switch filter, the exact column lists of both views,
-- the suppressed-listing link and the check constraints. Rolled back.
begin;
set local client_min_messages = warning;

do $$
declare
  r text;
begin
  -- The web app writes its own rows inside withUser: insert, and update of the sale columns only.
  -- The pipeline reads (for v_items) and deletes (the account.deleted purge); it never inserts.
  if not (has_table_privilege('nabvy_app', 'inventory.items', 'select')
          and has_table_privilege('nabvy_app', 'inventory.items', 'insert')) then
    raise exception 'nabvy_app lacks its items grants';
  end if;
  if has_table_privilege('nabvy_app', 'inventory.items', 'delete') then
    raise exception 'nabvy_app can delete items';
  end if;
  foreach r in array array['sold_minor', 'sold_at', 'sold_on', 'sold_recorded_at'] loop
    if not has_column_privilege('nabvy_app', 'inventory.items', r, 'update') then
      raise exception 'nabvy_app cannot update items.%', r;
    end if;
  end loop;
  foreach r in array array['id', 'user_id', 'product_key', 'source_listing_id', 'scan_id',
                           'currency', 'cost_minor', 'bought_at'] loop
    if has_column_privilege('nabvy_app', 'inventory.items', r, 'update') then
      raise exception 'nabvy_app can update items.% (only the sale columns may change)', r;
    end if;
  end loop;
  if not (has_table_privilege('nabvy_pipeline', 'inventory.items', 'select')
          and has_table_privilege('nabvy_pipeline', 'inventory.items', 'delete')) then
    raise exception 'nabvy_pipeline lacks its items purge grants';
  end if;
  if has_table_privilege('nabvy_pipeline', 'inventory.items', 'insert')
     or has_table_privilege('nabvy_pipeline', 'inventory.items', 'update') then
    raise exception 'nabvy_pipeline can write items (writes must go through withUser)';
  end if;

  -- Views: the internal one to the pipeline only, the user-facing one to the web app only.
  if not has_table_privilege('nabvy_pipeline', 'inventory.v_items', 'select')
     or has_table_privilege('nabvy_app', 'inventory.v_items', 'select') then
    raise exception 'v_items grants are wrong';
  end if;
  if not has_table_privilege('nabvy_app', 'app.v_inventory_items', 'select')
     or has_table_privilege('nabvy_pipeline', 'app.v_inventory_items', 'select') then
    raise exception 'app.v_inventory_items grants are wrong';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_schema_privilege(r, 'inventory', 'usage') then
      raise exception '% can use schema inventory', r;
    end if;
    if has_table_privilege(r, 'app.v_inventory_items', 'select') then
      raise exception '% can read app.v_inventory_items', r;
    end if;
  end loop;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
      where table_schema = 'app' and table_name = 'v_inventory_items')
     is distinct from array['id', 'product_key', 'source_listing_id', 'scan_id', 'currency',
                            'cost_minor', 'bought_at', 'sold_minor', 'sold_at', 'sold_on',
                            'profit_minor'] then
    raise exception 'app.v_inventory_items has other columns than the allowed list';
  end if;
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
      where table_schema = 'inventory' and table_name = 'v_items')
     is distinct from array['id', 'user_id', 'product_key', 'currency', 'cost_minor', 'bought_at',
                            'sold_minor', 'sold_at', 'sold_on', 'sold_recorded_at'] then
    raise exception 'v_items has other columns than the allowed list';
  end if;
  -- app.* is outside nabvy_core.view_violations()'s scope (docs/questions/listing-card.md), so the
  -- two view rules are asserted by hand for app.v_inventory_items: security_invoker, and no
  -- seller-like column.
  if not coalesce((select c.reloptions @> array['security_invoker=true']
                   from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'app' and c.relname = 'v_inventory_items'), false) then
    raise exception 'app.v_inventory_items is not security_invoker';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'app' and table_name = 'v_inventory_items'
               and column_name::text ~* '(seller|profile_(url|link|pic)|^raw$|^raw_|_raw$|source_fields|photo|user_id)') then
    raise exception 'app.v_inventory_items carries a seller, raw, photo or user column';
  end if;
  if exists (select 1 from nabvy_core.view_violations() where view_name like 'inventory.%') then
    raise exception 'an inventory view breaks the view rules';
  end if;
end;
$$;

-- Constraints: bounds on amounts, dates, the product key and the sale columns.
do $$
declare
  refused boolean;
  probe text;
begin
  foreach probe in array array[
    -- nothing names the item
    $q$insert into inventory.items (user_id, currency, cost_minor, bought_at) values ('00000000-0000-4000-8000-0000000000b1', 'GBP', 1, '2026-09-20')$q$,
    -- product key shape and length
    $q$insert into inventory.items (user_id, product_key, currency, cost_minor, bought_at) values ('00000000-0000-4000-8000-0000000000b1', 'RTX 3090', 'GBP', 1, '2026-09-20')$q$,
    $q$insert into inventory.items (user_id, product_key, currency, cost_minor, bought_at) values ('00000000-0000-4000-8000-0000000000b1', 'gpu:' || repeat('a', 200), 'GBP', 1, '2026-09-20')$q$,
    -- currency, amounts, earliest date
    $q$insert into inventory.items (user_id, product_key, currency, cost_minor, bought_at) values ('00000000-0000-4000-8000-0000000000b1', 'gpu:nvidia:rtx-3090', 'USD', 1, '2026-09-20')$q$,
    $q$insert into inventory.items (user_id, product_key, currency, cost_minor, bought_at) values ('00000000-0000-4000-8000-0000000000b1', 'gpu:nvidia:rtx-3090', 'GBP', -1, '2026-09-20')$q$,
    $q$insert into inventory.items (user_id, product_key, currency, cost_minor, bought_at) values ('00000000-0000-4000-8000-0000000000b1', 'gpu:nvidia:rtx-3090', 'GBP', 100000001, '2026-09-20')$q$,
    $q$insert into inventory.items (user_id, product_key, currency, cost_minor, bought_at) values ('00000000-0000-4000-8000-0000000000b1', 'gpu:nvidia:rtx-3090', 'GBP', 1, '1999-12-31')$q$,
    -- sale columns: together, ordered, and sold_on only with a sale and from the Source enum
    $q$insert into inventory.items (user_id, product_key, currency, cost_minor, bought_at, sold_minor) values ('00000000-0000-4000-8000-0000000000b1', 'gpu:nvidia:rtx-3090', 'GBP', 1, '2026-09-20', 2)$q$,
    $q$insert into inventory.items (user_id, product_key, currency, cost_minor, bought_at, sold_minor, sold_at, sold_recorded_at) values ('00000000-0000-4000-8000-0000000000b1', 'gpu:nvidia:rtx-3090', 'GBP', 1, '2026-09-20', 2, '2026-09-19', now())$q$,
    $q$insert into inventory.items (user_id, product_key, currency, cost_minor, bought_at, sold_minor, sold_at, sold_recorded_at) values ('00000000-0000-4000-8000-0000000000b1', 'gpu:nvidia:rtx-3090', 'GBP', 1, '2026-09-20', 100000001, '2026-09-21', now())$q$,
    $q$insert into inventory.items (user_id, product_key, currency, cost_minor, bought_at, sold_on) values ('00000000-0000-4000-8000-0000000000b1', 'gpu:nvidia:rtx-3090', 'GBP', 1, '2026-09-20', 'ebay')$q$,
    $q$insert into inventory.items (user_id, product_key, currency, cost_minor, bought_at, sold_minor, sold_at, sold_recorded_at, sold_on) values ('00000000-0000-4000-8000-0000000000b1', 'gpu:nvidia:rtx-3090', 'GBP', 1, '2026-09-20', 2, '2026-09-21', now(), 'carboot')$q$
  ] loop
    refused := false;
    begin
      execute probe;
    exception when check_violation then
      refused := true;
    end;
    if not refused then
      raise exception 'constraint did not refuse: %', probe;
    end if;
  end loop;
end;
$$;

-- RLS: a user sees, updates and inserts only their own rows, through withUser (app.user_id).
insert into switches.switches (name, kind, state) values
  ('inventory', 'module', 'on'), ('listing-suppression', 'module', 'on')
  on conflict (name) do update set state = 'on';
insert into inventory.items (id, user_id, product_key, currency, cost_minor, bought_at) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 'gpu:nvidia:rtx-3090', 'GBP', 42000, '2026-09-20'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b2', 'gpu:nvidia:rtx-3090', 'GBP', 30000, '2026-09-20');

set local role nabvy_app;
set local app.user_id = '00000000-0000-4000-8000-0000000000b1';
do $$
begin
  if (select count(*) from app.v_inventory_items) <> 1 then
    raise exception 'app.v_inventory_items does not show exactly the user''s own row';
  end if;
  if exists (select 1 from inventory.items where id = '00000000-0000-4000-8000-0000000000c2') then
    raise exception 'nabvy_app can see another user''s item';
  end if;
  update inventory.items set sold_minor = 1, sold_at = '2026-09-21', sold_recorded_at = now()
    where id = '00000000-0000-4000-8000-0000000000c2';
  if found then
    raise exception 'nabvy_app updated another user''s item';
  end if;
  -- The user's own sale, and profit as sold minus cost.
  update inventory.items set sold_minor = 55000, sold_at = '2026-09-24', sold_on = 'ebay', sold_recorded_at = now()
    where id = '00000000-0000-4000-8000-0000000000c1';
  if (select profit_minor from app.v_inventory_items where id = '00000000-0000-4000-8000-0000000000c1') <> 13000 then
    raise exception 'profit_minor is not sold minus cost';
  end if;
end;
$$;
do $$
declare
  refused boolean;
begin
  refused := false;
  begin
    insert into inventory.items (user_id, product_key, currency, cost_minor, bought_at)
      values ('00000000-0000-4000-8000-0000000000b2', 'gpu:nvidia:rtx-3090', 'GBP', 1, '2026-09-20');
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then
    raise exception 'nabvy_app inserted a row for another user';
  end if;
  refused := false;
  begin
    update inventory.items set cost_minor = 1 where id = '00000000-0000-4000-8000-0000000000c1';
  exception when insufficient_privilege then
    refused := true;
  end;
  if not refused then
    raise exception 'nabvy_app changed an item''s cost (only the sale columns may change)';
  end if;
end;
$$;
reset role;

-- The switch filter (rule 11): off empties both views; shadow shows internal rows only.
update switches.switches set state = 'shadow' where name = 'inventory';
set local role nabvy_app;
set local app.user_id = '00000000-0000-4000-8000-0000000000b1';
do $$
begin
  if exists (select 1 from app.v_inventory_items) then
    raise exception 'app.v_inventory_items shows rows while the module is in shadow';
  end if;
end;
$$;
reset role;
set local role nabvy_pipeline;
do $$
begin
  if not exists (select 1 from inventory.v_items) then
    raise exception 'v_items is empty in shadow, where it should still have rows';
  end if;
end;
$$;
reset role;
update switches.switches set state = 'off' where name = 'inventory';
set local role nabvy_pipeline;
do $$
begin
  if exists (select 1 from inventory.v_items) then
    raise exception 'v_items shows rows while the module is off';
  end if;
end;
$$;
reset role;

-- A suppressed listing's ID never reaches the user-facing view; the item itself stays (rule 5:
-- the view shows the user's own money record, not the listing). Off suppression fails closed.
update switches.switches set state = 'on' where name = 'inventory';
insert into switches.switches (name, kind, state) values
  ('listing-ingest', 'module', 'on'), ('detail-evidence', 'module', 'on')
  on conflict (name) do update set state = 'on';
insert into listing_ingest.listings
  (id, source, source_listing_id, card_hash, title, first_fetched_at, last_seen_at, availability, item_job_id, item_seq)
values
  ('00000000-0000-4000-8000-0000000000d1', 'facebook', 'db-test-inventory-1', repeat('0', 64), 'A listing', now(), now(), 'live', 0, 0);
insert into inventory.items (id, user_id, source_listing_id, currency, cost_minor, bought_at) values
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000d1', 'GBP', 42000, '2026-09-20');

set local role nabvy_app;
set local app.user_id = '00000000-0000-4000-8000-0000000000b1';
do $$
begin
  if (select source_listing_id from app.v_inventory_items where id = '00000000-0000-4000-8000-0000000000c3')
     is distinct from '00000000-0000-4000-8000-0000000000d1'::uuid then
    raise exception 'app.v_inventory_items hides the link to a listing that is not suppressed';
  end if;
end;
$$;
reset role;
insert into listing_suppression.entries (request_id, kind, value) values
  ('00000000-0000-4000-8000-0000000000e1', 'listing_hash', listing_suppression.listing_hash('facebook', 'db-test-inventory-1'));
set local role nabvy_app;
set local app.user_id = '00000000-0000-4000-8000-0000000000b1';
do $$
begin
  if not exists (select 1 from app.v_inventory_items where id = '00000000-0000-4000-8000-0000000000c3') then
    raise exception 'app.v_inventory_items drops the user''s item because its listing is suppressed';
  end if;
  if (select source_listing_id from app.v_inventory_items where id = '00000000-0000-4000-8000-0000000000c3') is not null then
    raise exception 'app.v_inventory_items shows a suppressed listing''s ID';
  end if;
end;
$$;
reset role;
update switches.switches set state = 'off' where name = 'listing-suppression';
set local role nabvy_app;
set local app.user_id = '00000000-0000-4000-8000-0000000000b1';
do $$
begin
  if (select source_listing_id from app.v_inventory_items where id = '00000000-0000-4000-8000-0000000000c1') is not null
     or exists (select 1 from app.v_inventory_items where source_listing_id is not null) then
    raise exception 'app.v_inventory_items shows a listing ID while listing-suppression is off';
  end if;
end;
$$;
reset role;

rollback;
