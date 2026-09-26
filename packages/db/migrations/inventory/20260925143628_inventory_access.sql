-- inventory: grants, RLS, views. Hand-written (packages/db/README.md). Depends on core (uuidv7,
-- track_updated_at, RLS/pipeline helpers), switches (switches.state/is_on), listing-card (the
-- shared `app` schema its migration creates), scan-recognition (v_user_scans, which the module
-- reads to link an item to the caller's own scan) and listing-suppression (is_suppressed).
comment on schema inventory is
  'Inventory: the items a user bought and sold, entered by the user. Owner: the inventory module.';
grant usage on schema inventory to nabvy_app, nabvy_pipeline;

-- items: written entirely by the web app inside withUser (addItem() and recordSale(), services/
-- inventory/src/index.ts). Column-level update: after insert, only the sale columns ever change
-- (a sale is recorded or corrected); cost, dates of purchase and what the item is are fixed at
-- insert. No delete for the app: the module has no removal function (docs/questions/
-- inventory.md). The pipeline reads for the internal view and purges a deleted account's rows
-- (account.deleted, rule 12 of docs/design/modules/_rules.md).
select nabvy_core.enable_user_rls('inventory.items');
grant select, insert on inventory.items to nabvy_app;
grant update (sold_minor, sold_at, sold_on, sold_recorded_at) on inventory.items to nabvy_app;
select nabvy_core.allow_pipeline('inventory.items', 'select');
select nabvy_core.allow_pipeline('inventory.items', 'delete');
grant select, delete on inventory.items to nabvy_pipeline;
select nabvy_core.track_updated_at('inventory.items');

-- Internal: every item with its user ID, for sold-reports (which asks the user for separate
-- consent before an amount enters an aggregate; docs/design/modules/sold-reports.md). Rows while
-- the switch is shadow or on (rule 11). No source listing or scan ID: a reader that needs the
-- product uses product_key. Carries a user ID, so it is never granted to nabvy_app (rule 5).
create view inventory.v_items with (security_invoker = true) as
  select id, user_id, product_key, currency, cost_minor, bought_at, sold_minor, sold_at, sold_on,
         sold_recorded_at
  from inventory.items
  where switches.state('inventory') <> 'off';
revoke all on inventory.v_items from public;
grant select on inventory.v_items to nabvy_pipeline;

-- User-facing: the caller's own items (RLS through security_invoker), only while the switch is
-- on (rule 11). Explicit column list: no user ID, no seller field, no listing content; only what
-- the user entered and the IDs that name the item. profit_minor is sold minus cost, the user's
-- own two numbers, null until sold. The item stays visible when its listing is suppressed (it is
-- the user's own money record), but the link to that listing is dropped: source_listing_id reads
-- null while the listing is suppressed or listing-suppression is off (fail closed, rule 11), so
-- the app can never join a suppressed listing back onto a card.
create view app.v_inventory_items with (security_invoker = true) as
  select
    id,
    product_key,
    case
      when source_listing_id is not null
       and switches.is_on('listing-suppression')
       and not listing_suppression.is_suppressed(source_listing_id)
      then source_listing_id
    end as source_listing_id,
    scan_id,
    currency,
    cost_minor,
    bought_at,
    sold_minor,
    sold_at,
    sold_on,
    sold_minor - cost_minor as profit_minor
  from inventory.items
  where switches.is_on('inventory');
revoke all on app.v_inventory_items from public, anon, authenticated;
grant select on app.v_inventory_items to nabvy_app;
