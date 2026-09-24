-- product-catalogue: grants and the internal views. Hand-written.
comment on schema product_catalogue is
  'Product catalogue: canonical parts and products, their aliases, negative contexts and codes. Owner: the product-catalogue module. Internal; not exposed to the Data API.';
revoke all on schema product_catalogue from public;
revoke all on product_catalogue.items from public;
revoke all on product_catalogue.aliases from public;
revoke all on product_catalogue.negative_contexts from public;
revoke all on product_catalogue.codes from public;

grant usage on schema product_catalogue to nabvy_pipeline;

-- Writers. No admin-write procedure exists yet, so admin edits and the pack seed both run as the
-- pipeline (docs/questions.md, "w1 product-catalogue: who may write the catalogue"; the same
-- interim choice as services/switches). No role may delete a row: an item, alias or negative
-- context is never removed by this build (services/product-catalogue/README.md, "Decisions").
grant select, insert, update on product_catalogue.items to nabvy_pipeline;
grant select, insert, update on product_catalogue.aliases to nabvy_pipeline;
grant select, insert, update on product_catalogue.negative_contexts to nabvy_pipeline;
grant select, insert, update on product_catalogue.codes to nabvy_pipeline;
select nabvy_core.track_updated_at('product_catalogue.items');

-- The read interface for other modules: security_invoker (no RLS on these tables; they hold no
-- user data), an explicit column list, and empty while the module is off (rule 11 of
-- docs/design/modules/_rules.md). Not filtered further in shadow: this module has no user-facing
-- views, so shadow and on read the same internally.
create view product_catalogue.v_items with (security_invoker = true) as
  select catalogue_id, kind, family, variant, is_mobile, pack_id, name
  from product_catalogue.items
  where switches.state('product-catalogue') <> 'off';
revoke all on product_catalogue.v_items from public;
grant select on product_catalogue.v_items to nabvy_pipeline;

create view product_catalogue.v_aliases with (security_invoker = true) as
  select id, catalogue_id, alias, source
  from product_catalogue.aliases
  where switches.state('product-catalogue') <> 'off';
revoke all on product_catalogue.v_aliases from public;
grant select on product_catalogue.v_aliases to nabvy_pipeline;

create view product_catalogue.v_negative_contexts with (security_invoker = true) as
  select id, pattern, blocked_catalogue_id, source
  from product_catalogue.negative_contexts
  where switches.state('product-catalogue') <> 'off';
revoke all on product_catalogue.v_negative_contexts from public;
grant select on product_catalogue.v_negative_contexts to nabvy_pipeline;
