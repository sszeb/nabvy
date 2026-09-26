-- Access and views for the pickup_location schema (packages/db/README.md, "Adding tables to a
-- module"; services/pickup-location/README.md). Depends on core (track_updated_at), switches
-- (switches.state, switches.is_on) and listing-suppression (is_suppressed, for the user-facing
-- view). The module reads listing-ingest's, detail-evidence's and city-pages' views from its
-- code, not from these views, so module.json lists them for apply order only.
--
-- Resolutions are pipeline data with no user rows, so there is no user_id and no RLS, as in
-- parts_rules. Only the pipeline role writes the tables; it may delete for erase() (rule 12) and
-- for the current-row upsert. nabvy_app gets select on app.v_pickup_location only: never a
-- table, never an internal view. Full postcodes, raw mention text and the field point
-- (field_lat/field_lng) never appear in any view.

grant usage on schema pickup_location to nabvy_pipeline;
grant select, insert, update, delete on
  pickup_location.resolutions, pickup_location.candidates, pickup_location.mentions,
  pickup_location.current, pickup_location.handover, pickup_location.overrides,
  pickup_location.ai_queue
  to nabvy_pipeline;

select nabvy_core.track_updated_at('pickup_location.resolutions');
select nabvy_core.track_updated_at('pickup_location.candidates');
select nabvy_core.track_updated_at('pickup_location.mentions');
select nabvy_core.track_updated_at('pickup_location.current');
select nabvy_core.track_updated_at('pickup_location.handover');
select nabvy_core.track_updated_at('pickup_location.overrides');
select nabvy_core.track_updated_at('pickup_location.ai_queue');

-- Internal views: security_invoker, explicit columns, never a seller field (the rules read
-- none), never a full postcode or the field point. Empty while the switch is off (rule 11);
-- shadow and on show rows.

-- The resolved area of each listing: town or area only, with its status and whether the text
-- and the field disagreed.
create view pickup_location.v_areas with (security_invoker = true) as
select c.listing_id, c.town_or_area, c.approximate, c.conflict, c.basis, c.status
from pickup_location.current c
where switches.state('pickup-location') <> 'off';

-- Mentions and candidates with redacted quotes, for review-console. A candidate row shows the
-- gazetteer label or district it matched (never the value as found); a mention row shows where
-- it was found and the quote after quote-redaction.
create view pickup_location.v_evidence with (security_invoker = true) as
select
  r.listing_id, r.pass, r.evidence_hash, r.rule_version, 'candidate'::text as kind, k.seq,
  k.role, k.cue, k.strength, k.label, k.rejection,
  null::text as quote, null::text as source, null::integer as "start", null::integer as "end"
from pickup_location.candidates k
join pickup_location.resolutions r on r.id = k.resolution_id
where switches.state('pickup-location') <> 'off'
union all
select
  r.listing_id, r.pass, r.evidence_hash, r.rule_version, 'mention'::text as kind, m.seq,
  m.role, m.cue, m.strength, null::text as label, null::text as rejection,
  m.quote_redacted as quote, m.source, m.quote_start as "start", m.quote_end as "end"
from pickup_location.mentions m
join pickup_location.resolutions r on r.id = m.resolution_id
where switches.state('pickup-location') <> 'off';

-- The handover facts of each listing's current version (warning-signs, suspected-labels).
create view pickup_location.v_handover with (security_invoker = true) as
select
  h.listing_id, h.evidence_hash, h.collection, h.meetup_offered, h.local_delivery, h.postage,
  h.delivery_only_text, h.postage_only_text, h.courier_only_text
from pickup_location.handover h
where switches.state('pickup-location') <> 'off';

-- The AI lane's queue, for ops-metrics. No model is called in this push (question 12).
create view pickup_location.v_ai_usage with (security_invoker = true) as
select q.listing_id, q.evidence_hash, q.reason, q.queued_at, q.done_at
from pickup_location.ai_queue q
where switches.state('pickup-location') <> 'off';

revoke all on pickup_location.v_areas, pickup_location.v_evidence, pickup_location.v_handover,
  pickup_location.v_ai_usage
  from public, anon, authenticated;
grant select on pickup_location.v_areas, pickup_location.v_evidence, pickup_location.v_handover,
  pickup_location.v_ai_usage
  to nabvy_pipeline;

-- The user-facing view (rule 5; docs/security.md, "Cross-module reads behind a user-facing
-- view"). Schema app is created idempotently and closed to public; nabvy_app may use it. Rows
-- appear only while this module is on, only while listing-suppression is on (an off or
-- unreachable suppression module hides every listing), and never for a suppressed listing.
-- Listings with no area (status unknown) are left out: nothing to show, nothing to place.
-- lat/lng are the gazetteer display point of the shown area; the listing's own coordinates and
-- any full postcode stay in the tables. area_landmass is null until location carries landmass
-- data (services/pickup-location/README.md, "Decisions").
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to nabvy_app;

create view app.v_pickup_location with (security_invoker = true) as
select
  c.listing_id,
  c.town_or_area,
  c.approximate,
  c.area_id,
  c.area_district,
  null::text as area_landmass,
  c.status,
  c.source,
  c.note_code,
  c.note_place_label,
  c.listed_in_label,
  c.lat,
  c.lng,
  c.uncertainty_km,
  coalesce(h.collection, 'unknown') as collection,
  coalesce(h.meetup_offered, false) as meetup_offered,
  coalesce(h.local_delivery, 'none') as local_delivery,
  coalesce(h.postage, 'none') as postage
from pickup_location.current c
left join pickup_location.handover h on h.listing_id = c.listing_id
where switches.is_on('pickup-location')
  and switches.is_on('listing-suppression')
  and c.town_or_area is not null
  and c.lat is not null
  and not listing_suppression.is_suppressed(c.listing_id);

revoke all on app.v_pickup_location from public, anon, authenticated;
grant select on app.v_pickup_location to nabvy_app;
-- The tables behind a security_invoker view must be readable by the view's reader: nabvy_app
-- gets column-level select on exactly the columns the view shows, nothing else (never the
-- field point, never a candidate or mention), and row-level security gives it exactly the rows
-- the view shows, so a direct read of the table by the app role sees no more than the view
-- (rows only while this module and listing-suppression are on, never a suppressed listing).
-- The pipeline role keeps every row through allow_pipeline.
grant usage on schema pickup_location to nabvy_app;
grant select (listing_id, town_or_area, approximate, area_id, area_district, status, source,
  note_code, note_place_label, listed_in_label, lat, lng, uncertainty_km)
  on pickup_location.current to nabvy_app;
grant select (listing_id, collection, meetup_offered, local_delivery, postage)
  on pickup_location.handover to nabvy_app;
select nabvy_core.allow_pipeline('pickup_location.current', 'all');
select nabvy_core.allow_pipeline('pickup_location.handover', 'all');
create policy app_user_facing on pickup_location.current for select to nabvy_app
  using (switches.is_on('pickup-location') and switches.is_on('listing-suppression')
         and not listing_suppression.is_suppressed(listing_id));
create policy app_user_facing on pickup_location.handover for select to nabvy_app
  using (switches.is_on('pickup-location') and switches.is_on('listing-suppression')
         and not listing_suppression.is_suppressed(listing_id));
