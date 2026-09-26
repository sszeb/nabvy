-- demand-signals: grants and the internal view. Hand-written (packages/db/README.md, "Adding tables
-- to a module"). Depends on core (track_updated_at) and switches (switches.state). The module reads
-- want-manager (v_want_terms_by_centre), listing-assessment (v_assessments), listing-ingest
-- (v_listings), city-pages (v_area_membership), product-catalogue (v_items) and copy-advert
-- (v_members, soft) from its code as nabvy_pipeline, so module.json lists them for apply order.
comment on schema demand_signals is
  'Demand signals: weekly want and wanted-advert counts per centre and catalogue family, small cells suppressed. Owner: the demand-signals module.';

-- Cells are pipeline aggregates with no user rows (no user_id, so no RLS). Only the pipeline role
-- reads and writes them, with the least it needs: a cell is inserted once and never rewritten (a
-- replay of the same week inserts nothing; a rule change is a new rule_version). No update, no
-- delete: the table holds no listing or user row for seller-rights or account.deleted to erase.
-- nabvy_app gets nothing: no user-facing view until the owner says who sees demand data (card).
grant usage on schema demand_signals to nabvy_pipeline;
grant select, insert on demand_signals.cells to nabvy_pipeline;
select nabvy_core.track_updated_at('demand_signals.cells');

-- Internal: every published cell, suppressed ones with null counts (the table never holds a count
-- under 10). security_invoker, explicit columns, no user ID, no seller field, no listing ID. Rows
-- while the module is shadow or on (rule 11).
create view demand_signals.v_cells with (security_invoker = true) as
select c.week_start, c.centre_id, c.family, c.wants, c.adverts, c.suppressed, c.rule_version,
       c.published_at
from demand_signals.cells c
where switches.state('demand-signals') <> 'off';

revoke all on demand_signals.v_cells from public, anon, authenticated;
grant select on demand_signals.v_cells to nabvy_pipeline;
