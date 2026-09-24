-- Access and views for the listing_ingest schema (packages/db/README.md, "Adding tables to a
-- module"; services/listing-ingest/README.md). Depends on core (uuidv7, track_updated_at),
-- switches (switches.state) and apify-gateway (whose v_rows this module reads).
--
-- Listing identities and sightings are pipeline data with no user rows, so there is no user_id
-- and no RLS, as in incidents. Only the pipeline role (nabvy_pipeline; per-module roles are
-- question 2 of the catalogue) reads and writes the tables. It may delete only for erase()
-- (rule 12: seller-rights erasure). nabvy_app gets nothing: this module publishes no
-- user-facing view (rule 5; acquisition modules run before listing-suppression).

grant usage on schema listing_ingest to nabvy_pipeline;
grant select, insert, update, delete on listing_ingest.listings, listing_ingest.sightings
  to nabvy_pipeline;

select nabvy_core.track_updated_at('listing_ingest.listings');
select nabvy_core.track_updated_at('listing_ingest.sightings');

-- Internal views: security_invoker, explicit columns, never a seller field or the raw row (it
-- stays in apify_gateway.items, referenced by item_job_id and item_seq). Empty while the module's
-- switch is off (rule 11); shadow and on show rows.

create view listing_ingest.v_listings with (security_invoker = true) as
select
  l.id, l.source, l.source_listing_id, l.card_hash, l.price_minor, l.currency, l.money_kind,
  l.title, l.listed_at, l.first_fetched_at, l.last_seen_at, l.city_page_id, l.town_label,
  l.availability, l.category_id, l.delivery_types, l.primary_photo_id,
  l.displayed_previous_minor, l.binding, l.found_by_terms, l.item_job_id, l.item_seq
from listing_ingest.listings l
where switches.state('listing-ingest') <> 'off';

create view listing_ingest.v_sightings with (security_invoker = true) as
select
  s.id, s.listing_id, s.job_id, s.seq, s.kind, s.terms, s.centre_ids, s.rank, s.card_hash,
  s.price_minor, s.currency, s.availability, s.seen_at
from listing_ingest.sightings s
where switches.state('listing-ingest') <> 'off';

-- A price change is two consecutive priced observations of one listing ID (search or detail),
-- in the same currency, at different amounts. Compared on price_minor and currency only, never
-- the display text (the same £499 arrives as "£499" and "499.00").
create view listing_ingest.v_price_changes with (security_invoker = true) as
with priced as (
  select
    s.id, s.listing_id, s.kind, s.price_minor, s.currency, s.seen_at,
    lag(s.price_minor) over w as previous_minor,
    lag(s.currency) over w as previous_currency,
    lag(s.seen_at) over w as previous_seen_at
  from listing_ingest.sightings s
  where s.price_minor is not null
  window w as (partition by s.listing_id order by s.seen_at, s.job_id, s.kind)
)
select
  p.listing_id, p.id as sighting_id, p.kind, p.previous_minor, p.price_minor, p.currency,
  p.previous_seen_at, p.seen_at
from priced p
where p.previous_minor is not null
  and p.previous_currency = p.currency
  and p.previous_minor <> p.price_minor
  and switches.state('listing-ingest') <> 'off';

-- Each city page listings were placed in (a listing is placed by its own city page, never by the
-- centre that found it), with the latest town label seen for it.
create view listing_ingest.v_city_pages_seen with (security_invoker = true) as
select
  l.city_page_id,
  (array_agg(l.town_label order by l.last_seen_at desc) filter (where l.town_label is not null))[1]
    as town_label,
  count(*)::integer as listings,
  min(l.first_fetched_at) as first_seen_at,
  max(l.last_seen_at) as last_seen_at
from listing_ingest.listings l
where l.city_page_id is not null
  and switches.state('listing-ingest') <> 'off'
group by l.city_page_id;

-- Look-alike fingerprint for listing-suppression only: SHA-256 of the normalised title (lower
-- case, whitespace collapsed), price and currency, and city page. Nothing seller-derived.
create view listing_ingest.v_fingerprints with (security_invoker = true) as
select
  l.id as listing_id,
  encode(
    sha256(convert_to(concat_ws('|',
      lower(btrim(regexp_replace(l.title, '\s+', ' ', 'g'))),
      coalesce(l.price_minor::text, ''),
      coalesce(l.currency, ''),
      coalesce(l.city_page_id, '')
    ), 'UTF8')),
    'hex'
  ) as fingerprint
from listing_ingest.listings l
where switches.state('listing-ingest') <> 'off';

revoke all on listing_ingest.v_listings, listing_ingest.v_sightings,
  listing_ingest.v_price_changes, listing_ingest.v_city_pages_seen, listing_ingest.v_fingerprints
  from public, anon, authenticated;
grant select on listing_ingest.v_listings, listing_ingest.v_sightings,
  listing_ingest.v_price_changes, listing_ingest.v_city_pages_seen, listing_ingest.v_fingerprints
  to nabvy_pipeline;
