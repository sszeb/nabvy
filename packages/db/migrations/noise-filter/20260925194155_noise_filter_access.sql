-- Access and views for the noise_filter schema (packages/db/README.md, "Adding tables to a
-- module"; services/noise-filter/README.md). Depends on core (track_updated_at, allow_pipeline),
-- switches (switches.state, switches.is_on) and listing-suppression (is_suppressed, for the
-- user-facing view). The module reads listing-assessment's, parts-record's, parts-rules',
-- listing-ingest's and detail-evidence's views from its code, not from these views, so
-- module.json lists them for apply order only.
--
-- Classifications are pipeline data with no user rows, so there is no user_id. Only the pipeline
-- role writes the table, with the least it needs: a new input is a new row, and a row is never
-- rewritten except its classified_at, when inputs return to an earlier state and that row
-- becomes the latest again; delete only for erase() (rule 12: seller-rights erasure). nabvy_app
-- gets select on app.v_noise_filter_reasons, and column-level select on the four columns that
-- view reads, behind a row-level policy that shows exactly the rows the view may show.

grant usage on schema noise_filter to nabvy_pipeline;
grant select, insert, delete on noise_filter.classifications to nabvy_pipeline;
grant update (classified_at) on noise_filter.classifications to nabvy_pipeline;

select nabvy_core.track_updated_at('noise_filter.classifications');
select nabvy_core.allow_pipeline('noise_filter.classifications', 'all');

-- Internal view: security_invoker, explicit columns, never a seller field (no input carries
-- one). The latest classification of each listing version: the row with the latest
-- classified_at (then the latest id) among the same listing and evidence hash. Empty while the
-- module's switch is off (rule 11); shadow and on show rows.
create view noise_filter.v_classifications with (security_invoker = true) as
select
  c.listing_id, c.evidence_hash, c.input_hash, c.rule_version, c.reasons, c.evidence, c.terms,
  c.fetched_at, c.classified_at
from (
  select distinct on (x.listing_id, x.evidence_hash) x.*
  from noise_filter.classifications x
  order by x.listing_id, x.evidence_hash, x.classified_at desc, x.id desc
) c
where switches.state('noise-filter') <> 'off';

revoke all on noise_filter.v_classifications from public, anon, authenticated;
grant select on noise_filter.v_classifications to nabvy_pipeline;

-- The user-facing view (rule 5; docs/security.md, "Cross-module reads behind a user-facing
-- view"). It reads only this module's own table; the one cross-module read is
-- listing_suppression.is_suppressed(), the SECURITY DEFINER predicate granted to nabvy_app.
-- Schema app is created idempotently and closed to public; nabvy_app may use it. Rows appear
-- only while this module is on (off or shadow: no rows, so every listing shows, as the card's
-- "When off" says), only while listing-suppression is on (an off or unreachable suppression
-- module hides every listing), and never for a suppressed listing. One row per listing: its
-- latest classification, only when that has at least one reason. Reason codes only: no quote,
-- no term, no seller field.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to nabvy_app;

create view app.v_noise_filter_reasons with (security_invoker = true) as
select c.listing_id, c.reasons
from (
  select distinct on (x.listing_id) x.listing_id, x.reasons
  from noise_filter.classifications x
  order by x.listing_id, x.classified_at desc, x.id desc
) c
where switches.is_on('noise-filter')
  and switches.is_on('listing-suppression')
  and jsonb_array_length(c.reasons) > 0
  and not listing_suppression.is_suppressed(c.listing_id);

revoke all on app.v_noise_filter_reasons from public, anon, authenticated;
grant select on app.v_noise_filter_reasons to nabvy_app;

-- The table behind a security_invoker view must be readable by the view's reader: nabvy_app gets
-- column-level select on exactly the columns the view reads (never evidence, terms or hashes),
-- and row-level security gives it exactly the rows the view may show, so a direct read of the
-- table by the app role sees no more than the view (rows only while this module and
-- listing-suppression are on, never a suppressed listing). The pipeline role keeps every row
-- through allow_pipeline above.
grant usage on schema noise_filter to nabvy_app;
grant select (id, listing_id, reasons, classified_at) on noise_filter.classifications to nabvy_app;
create policy app_user_facing on noise_filter.classifications for select to nabvy_app
  using (switches.is_on('noise-filter') and switches.is_on('listing-suppression')
         and not listing_suppression.is_suppressed(listing_id));
