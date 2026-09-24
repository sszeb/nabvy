-- Access and views for the detail_evidence schema (packages/db/README.md, "Adding tables to a
-- module"; services/detail-evidence/README.md). Depends on core (uuidv7, track_updated_at),
-- switches (switches.state), apify-gateway (whose v_rows this module reads) and listing-ingest
-- (whose v_listings gives the listing IDs).
--
-- Detail versions and fetches are pipeline data with no user rows, so there is no user_id and no
-- RLS, as in listing_ingest. Only the pipeline role (nabvy_pipeline; per-module roles are
-- question 2 of the catalogue) reads and writes the tables. It may delete only for erase()
-- (rule 12: seller-rights erasure). nabvy_app gets nothing: this module publishes no
-- user-facing view (rule 5; acquisition modules run before listing-suppression).

grant usage on schema detail_evidence to nabvy_pipeline;
grant select, insert, update, delete on detail_evidence.evidence, detail_evidence.fetches
  to nabvy_pipeline;

select nabvy_core.track_updated_at('detail_evidence.evidence');
select nabvy_core.track_updated_at('detail_evidence.fetches');

-- Internal views: security_invoker, explicit columns, never a seller field or the raw row (it
-- stays in apify_gateway.items, referenced by item_job_id and item_seq). Empty while the module's
-- switch is off (rule 11); shadow and on show rows.

-- The current version of a listing: the version of its latest fresh fetch; a fetch served from a
-- stale cache (stale-fallback) counts only while the listing has no fresh one, because stale text
-- is "not proof the seller has not edited the item".
create view detail_evidence.v_current with (security_invoker = true) as
with current_fetch as (
  select distinct on (f.source, f.source_listing_id)
    f.source, f.source_listing_id, f.evidence_hash
  from detail_evidence.fetches f
  where f.evidence_hash is not null
  order by f.source, f.source_listing_id, f.stale_fallback, f.fetched_at desc, f.job_id desc
)
select
  e.listing_id, e.source, e.source_listing_id, e.evidence_hash, e.first_seen_at, e.last_seen_at,
  e.item_job_id, e.item_seq, e.description_status, e.description is not null as has_description,
  e.attributes, e.detail_sections, e.custom_title, e.custom_subtitles, e.condition, e.category_id,
  e.category_path, e.inventory_type, e.lat, e.lng, e.gallery_total, e.gallery_complete,
  e.photo_ids, e.links_expire_at, e.detail_outcome, e.stale_fallback
from current_fetch c
join detail_evidence.evidence e
  on e.source = c.source and e.source_listing_id = c.source_listing_id
  and e.evidence_hash = c.evidence_hash
where switches.state('detail-evidence') <> 'off';

-- The description text of every version: interpretation reads the text of the hash it works on.
create view detail_evidence.v_text with (security_invoker = true) as
select e.listing_id, e.evidence_hash, e.description_status, e.description, e.title
from detail_evidence.evidence e
where switches.state('detail-evidence') <> 'off';

-- Every detail fetch: outcome, attempts, cache status, unresolved, and the version it gave.
create view detail_evidence.v_outcomes with (security_invoker = true) as
select
  f.listing_id, f.source, f.source_listing_id, f.job_id, f.seq, f.fetched_at, f.detail_outcome,
  f.detail_attempts, f.description_status, f.cache_status, f.stale_fallback, f.unresolved,
  f.evidence_hash
from detail_evidence.fetches f
where switches.state('detail-evidence') <> 'off';

-- Copy-advert fingerprint of the current version: SHA-256 of the description, lower case,
-- whitespace collapsed and trimmed. Nothing seller-derived.
create view detail_evidence.v_fingerprints with (security_invoker = true) as
select
  c.listing_id, c.evidence_hash,
  encode(
    sha256(convert_to(lower(btrim(regexp_replace(e.description, '\s+', ' ', 'g'))), 'UTF8')),
    'hex'
  ) as fingerprint
from detail_evidence.v_current c
join detail_evidence.evidence e
  on e.source = c.source and e.source_listing_id = c.source_listing_id
  and e.evidence_hash = c.evidence_hash
where e.description is not null
  and btrim(e.description) <> '';

revoke all on detail_evidence.v_current, detail_evidence.v_text, detail_evidence.v_outcomes,
  detail_evidence.v_fingerprints
  from public, anon, authenticated;
grant select on detail_evidence.v_current, detail_evidence.v_text, detail_evidence.v_outcomes,
  detail_evidence.v_fingerprints
  to nabvy_pipeline;
