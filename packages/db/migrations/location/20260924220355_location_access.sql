-- Access for the location schema (packages/db/README.md, "Adding tables to a module";
-- services/location/README.md). Depends on core (track_updated_at) only: this module publishes
-- no views, so it needs nothing from switches or city-pages at the SQL level; @nabvy/location
-- checks switches.state('location') from application code before touching this table.
--
-- postcode_cache holds no user_id and no seller data: a postcode's coordinate is the same for
-- every user, so it is a plain shared cache, not a user row, and there is nothing here for
-- seller-rights erasure (rule 12 of docs/design/modules/_rules.md). It is read and written both
-- from the web app (a user's own postcode, inside withUser) and from the pipeline (notifier), so
-- both roles get the same grants; neither may delete a row (a cached postcode is never removed).

grant usage on schema location to nabvy_app, nabvy_pipeline;
grant select, insert on location.postcode_cache to nabvy_app, nabvy_pipeline;

select nabvy_core.track_updated_at('location.postcode_cache');
