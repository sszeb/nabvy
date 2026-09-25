-- Access and views for the details_selector schema (packages/db/README.md, "Adding tables to a
-- module"; services/details-selector/README.md). Depends on core (uuidv7, track_updated_at),
-- switches (switches.state), listing-ingest (v_listings) and city-pages (v_area_membership), whose
-- views the module reads. want-manager's v_want_areas is a soft edge and is not read here: the
-- module reads none of its tables (docs/questions/details-selector.md).
--
-- Selections are pipeline data with no user rows, so there is no user_id and no RLS, as in
-- relist_merge. Only the pipeline role (nabvy_pipeline; per-module roles are question 2 of the
-- catalogue) reads and writes the table; it may delete only for erase() (rule 12: seller-rights
-- erasure). nabvy_app gets nothing: selection is never shown to users (rule 5).

grant usage on schema details_selector to nabvy_pipeline;
grant select, insert, update, delete on details_selector.selections to nabvy_pipeline;

select nabvy_core.track_updated_at('details_selector.selections');

-- Internal view: security_invoker, explicit columns, no seller field or seller key (none is
-- stored). Empty while the module's switch is off (rule 11); shadow and on show rows, since the
-- module has no user-facing output.
create view details_selector.v_selections with (security_invoker = true) as
select source, source_listing_id, card_hash, reason, selected_at
from details_selector.selections
where switches.state('details-selector') <> 'off';

revoke all on details_selector.v_selections from public, anon, authenticated;
grant select on details_selector.v_selections to nabvy_pipeline;
