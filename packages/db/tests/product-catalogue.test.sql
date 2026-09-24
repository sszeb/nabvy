-- product-catalogue: grants, view rules, switch gating, the pack seed and the pg_trgm tier.
-- Rolled back.
begin;
set local client_min_messages = warning;

-- Grants: the pipeline reads and writes every table (never deletes) and reads the views; nobody
-- else can reach the schema.
do $$
declare
  t text;
  r text;
begin
  foreach t in array array['items', 'aliases', 'negative_contexts', 'codes'] loop
    if not (has_table_privilege('nabvy_pipeline', 'product_catalogue.' || t, 'select')
            and has_table_privilege('nabvy_pipeline', 'product_catalogue.' || t, 'insert')
            and has_table_privilege('nabvy_pipeline', 'product_catalogue.' || t, 'update')) then
      raise exception 'nabvy_pipeline lacks its product_catalogue.% grants', t;
    end if;
    if has_table_privilege('nabvy_pipeline', 'product_catalogue.' || t, 'delete')
       or has_table_privilege('nabvy_pipeline', 'product_catalogue.' || t, 'truncate') then
      raise exception 'nabvy_pipeline can delete product_catalogue.%', t;
    end if;
    if has_table_privilege('nabvy_app', 'product_catalogue.' || t, 'select') then
      raise exception 'nabvy_app can read product_catalogue.% directly', t;
    end if;
  end loop;
  foreach t in array array['v_items', 'v_aliases', 'v_negative_contexts'] loop
    if not has_table_privilege('nabvy_pipeline', 'product_catalogue.' || t, 'select') then
      raise exception 'nabvy_pipeline cannot read product_catalogue.%', t;
    end if;
    if has_table_privilege('nabvy_app', 'product_catalogue.' || t, 'select') then
      raise exception 'nabvy_app can read product_catalogue.% (internal only)', t;
    end if;
  end loop;
  foreach r in array array['anon', 'authenticated'] loop
    if has_schema_privilege(r, 'product_catalogue', 'usage') then
      raise exception '% can use schema product_catalogue', r;
    end if;
  end loop;
  if exists (select 1 from nabvy_core.view_violations() where view_name like 'product_catalogue.%') then
    raise exception 'a product_catalogue view breaks the view rules';
  end if;
end;
$$;

-- The pack seed (packages/db/migrations/product-catalogue/*_product_catalogue_seed.sql).
do $$
declare
  item_count int;
  mobile_count int;
  alias_count int;
  negative_count int;
begin
  select count(*) into item_count from product_catalogue.items;
  select count(*) into mobile_count from product_catalogue.items where is_mobile;
  select count(*) into alias_count from product_catalogue.aliases;
  select count(*) into negative_count from product_catalogue.negative_contexts;
  if item_count < 100 or mobile_count = 0 or alias_count < 100 or negative_count = 0 then
    raise exception 'the pack seed looks incomplete: % items (% mobile), % aliases, % negative contexts',
      item_count, mobile_count, alias_count, negative_count;
  end if;
  if not exists (
    select 1 from product_catalogue.items
    where catalogue_id = 'gpu:nvidia:rtx-5080:16gb' and not is_mobile
  ) or not exists (
    select 1 from product_catalogue.items
    where catalogue_id = 'gpu:nvidia:rtx-5080:mobile' and is_mobile
  ) then
    raise exception 'the desktop and mobile RTX 5080 are not both seeded as distinct items';
  end if;
  if not exists (
    select 1 from product_catalogue.negative_contexts
    where blocked_catalogue_id = 'gpu:nvidia:rtx-3090:24gb' and pattern ~* 'optiplex'
  ) then
    raise exception 'the OptiPlex negative context for the RTX 3090 is missing';
  end if;
end;
$$;

-- Switch gating (rule 11 of docs/design/modules/_rules.md): off empties every internal view.
do $$
declare
  n int;
begin
  insert into switches.switches (name, kind, state) values ('product-catalogue', 'module', 'off')
    on conflict (name) do update set state = 'off';
  select count(*) into n from product_catalogue.v_items;
  if n <> 0 then raise exception 'v_items is not empty while product-catalogue is off'; end if;
  select count(*) into n from product_catalogue.v_aliases;
  if n <> 0 then raise exception 'v_aliases is not empty while product-catalogue is off'; end if;
  select count(*) into n from product_catalogue.v_negative_contexts;
  if n <> 0 then raise exception 'v_negative_contexts is not empty while product-catalogue is off'; end if;

  update switches.switches set state = 'on' where name = 'product-catalogue';
  select count(*) into n from product_catalogue.v_items;
  if n = 0 then raise exception 'v_items is empty while product-catalogue is on'; end if;
end;
$$;

-- The pg_trgm tier (services/product-catalogue's resolve(), second tier): not reachable in this
-- module's own PGlite-based tests (services/product-catalogue/test/support/database.ts).
do $$
declare
  best text;
begin
  select catalogue_id into best from product_catalogue.items
    order by extensions.similarity(name, 'rtx 5080 16 gb') desc limit 1;
  if best is distinct from 'gpu:nvidia:rtx-5080:16gb' then
    raise exception 'pg_trgm similarity did not find the closest item name (got %)', best;
  end if;
end;
$$;

-- Referential integrity and the catalogue ID format.
do $$
begin
  begin
    insert into product_catalogue.aliases (catalogue_id, alias, source)
      values ('gpu:nvidia:does-not-exist:1gb', 'x', 'admin');
    raise exception 'an alias for an unknown catalogue ID was accepted';
  exception when foreign_key_violation then
  end;
  begin
    insert into product_catalogue.items (catalogue_id, kind, name) values ('not a valid id', 'gpu', 'x');
    raise exception 'a malformed catalogue ID was accepted';
  exception when check_violation then
  end;
end;
$$;

rollback;
