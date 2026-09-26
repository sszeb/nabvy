-- Access and views for the asking_price_position schema (packages/db/README.md, "Adding tables to a
-- module"; services/asking-price-position/README.md). Depends on core (track_updated_at), switches
-- (switches.state, switches.is_on) and listing-suppression (is_suppressed). The module reads the
-- index's views from pipeline code only and copies the figures it shows into its own table, so no
-- view here reads another module's view and the user-facing view needs no SECURITY DEFINER
-- function of its own (docs/security.md, "Cross-module reads behind a user-facing view").
--
-- Positions are pipeline data with no user rows, so there is no user_id. Only the pipeline role
-- (nabvy_pipeline; per-module roles are question 2 of the catalogue) writes the table; it deletes
-- for erase() and for listings that left a group. nabvy_app reads only the shown columns, through
-- app.v_asking_price_position, at n>=10 (nabvy/docs/decisions.md:15). Percentile, robust z, the
-- hashes and the new-build context are internal and never granted to nabvy_app (no score shown).

grant usage on schema asking_price_position to nabvy_pipeline;
grant select, insert, update, delete on asking_price_position.positions to nabvy_pipeline;

select nabvy_core.track_updated_at('asking_price_position.positions');

-- Internal view: security_invoker, explicit columns, no seller field or seller key (none is
-- stored). Every position, shown or not, with its T4. Empty while the module's switch is off.
create view asking_price_position.v_positions with (security_invoker = true) as
select
  p.listing_id, p.group_key, p.ask_minor, p.rank, p.n, p.percentile, p.robust_z, p.label,
  p.median, p.range_low, p.range_high, p.currency, p.new_median, p.new_n, p.stats_as_of,
  p.positioned_at
from asking_price_position.positions p
where switches.state('asking-price-position') <> 'off';

revoke all on asking_price_position.v_positions from public, anon, authenticated;
grant select on asking_price_position.v_positions to nabvy_pipeline;

-- User-facing position: listing, group label, rank, n, median, p25-p75 range and currency, only
-- at n>=10, never for a suppressed listing, and only while this module, the index it was computed
-- from and listing-suppression are on (rules 5 and 11). No percentile, no score, no "worth",
-- "fair" or "sale price" (PARTS_INTELLIGENCE.md:365-367), no seller key.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to nabvy_app;

create view app.v_asking_price_position with (security_invoker = true) as
select p.listing_id, p.label, p.rank, p.n, p.median, p.range_low, p.range_high, p.currency
from asking_price_position.positions p
where p.n >= 10 and p.rank is not null and p.median is not null
  and p.range_low is not null and p.range_high is not null
  and switches.is_on('asking-price-position')
  and switches.is_on('asking-price-index')
  and switches.is_on('listing-suppression')
  and not listing_suppression.is_suppressed(p.listing_id);

revoke all on app.v_asking_price_position from public, anon, authenticated;
grant select on app.v_asking_price_position to nabvy_app;

-- The view is security_invoker, so nabvy_app needs the shown columns and nothing else; row-level
-- security repeats the n>=10 and switch conditions on the table itself.
grant usage on schema asking_price_position to nabvy_app;
grant select (listing_id, label, rank, n, median, range_low, range_high, currency)
  on asking_price_position.positions to nabvy_app;

alter table asking_price_position.positions enable row level security;
create policy pipeline_all on asking_price_position.positions for all to nabvy_pipeline
  using (true) with check (true);
create policy app_shown on asking_price_position.positions for select to nabvy_app
  using (n >= 10 and switches.is_on('asking-price-position')
         and switches.is_on('asking-price-index')
         and switches.is_on('listing-suppression'));
