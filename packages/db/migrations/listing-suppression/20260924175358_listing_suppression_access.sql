-- Access, views and functions for the listing_suppression schema (packages/db/README.md, "Adding
-- tables to a module"; services/listing-suppression/README.md). Depends on core (uuidv7,
-- track_updated_at), switches (switches.state), listing-ingest (v_listings, v_fingerprints) and
-- detail-evidence (v_fingerprints).
--
-- The suppression list is pipeline data with no user rows, so there is no user_id and no RLS.
-- Only the pipeline role (nabvy_pipeline; per-module roles are question 2 of the catalogue)
-- reads and inserts entries. No role may update or delete one: the module deletes nothing, and a
-- look-alike entry stops matching at expires_at. nabvy_app gets usage on the schema only to call
-- is_suppressed(); it has no grant on the table or on v_suppressed (rule 5).
--
-- The switch filter (rule 11) deliberately does not apply here: v_suppressed and is_suppressed()
-- always answer, and "off" stops nothing but batch work (this module has none). User-facing views
-- of listings add `and switches.is_on('listing-suppression')` themselves, so an off module hides
-- every listing instead of showing suppressed ones again.

grant usage on schema listing_suppression to nabvy_pipeline, nabvy_app;
grant select, insert on listing_suppression.entries to nabvy_pipeline;

select nabvy_core.track_updated_at('listing_suppression.entries');

-- The listing hash: SHA-256 of 'source:source_listing_id', lowercase hex. The same function as
-- listingHash() in services/listing-suppression/src/domain (a test checks both on one ID). No
-- salt: the listing ID itself is stored in plain by listing-ingest, and the view below must
-- compute the hash in SQL (README, "Decisions").
create function listing_suppression.listing_hash(source text, source_listing_id text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(sha256(convert_to(source || ':' || source_listing_id, 'UTF8')), 'hex')
$$;

-- Internal: the listings the list hides now. A named listing is hidden with no end; a look-alike
-- (the named listing's card fingerprint or current description fingerprint) hides matching
-- listings until its entry expires. Seller-key entries are recorded but not resolved until
-- seller-key publishes restricted_listing_keys (docs/questions/listing-suppression.md). One row
-- per listing and reason; until is null when any matching entry never expires.
create view listing_suppression.v_suppressed with (security_invoker = true) as
with matches as (
  select l.id as listing_id, e.kind as reason, e.expires_at
  from listing_suppression.entries e
  join listing_ingest.v_listings l
    on e.value = listing_suppression.listing_hash(l.source, l.source_listing_id)
  where e.kind = 'listing_hash'
  union all
  select f.listing_id, e.kind, e.expires_at
  from listing_suppression.entries e
  join listing_ingest.v_fingerprints f on f.fingerprint = e.value
  where e.kind = 'lookalike' and e.basis = 'card' and e.expires_at > now()
  union all
  select f.listing_id, e.kind, e.expires_at
  from listing_suppression.entries e
  join detail_evidence.v_fingerprints f on f.fingerprint = e.value
  where e.kind = 'lookalike' and e.basis = 'description' and e.expires_at > now()
)
select
  m.listing_id,
  m.reason,
  case when bool_or(m.expires_at is null) then null else max(m.expires_at) end as until
from matches m
group by m.listing_id, m.reason;

-- Whether a listing is hidden now: what every user-facing view of listings calls, and what
-- notifier checks before sending. SECURITY DEFINER, so callers need no grant on the table or on
-- v_suppressed. Fails closed: while a module whose view an active entry needs is off (its views
-- are empty), every listing reads as suppressed rather than slipping through; a null ID too.
create function listing_suppression.is_suppressed(listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    is_suppressed.listing_id is null
    or (
      switches.state('listing-ingest') = 'off'
      and exists (
        select 1 from listing_suppression.entries e
        where e.kind = 'listing_hash'
           or (e.kind = 'lookalike' and e.basis = 'card' and e.expires_at > now())
      )
    )
    or (
      switches.state('detail-evidence') = 'off'
      and exists (
        select 1 from listing_suppression.entries e
        where e.kind = 'lookalike' and e.basis = 'description' and e.expires_at > now()
      )
    )
    or exists (
      select 1
      from listing_ingest.v_listings l
      join listing_suppression.entries e
        on e.kind = 'listing_hash'
       and e.value = listing_suppression.listing_hash(l.source, l.source_listing_id)
      where l.id = is_suppressed.listing_id
    )
    or exists (
      select 1
      from listing_ingest.v_fingerprints f
      join listing_suppression.entries e
        on e.kind = 'lookalike' and e.basis = 'card' and e.value = f.fingerprint
       and e.expires_at > now()
      where f.listing_id = is_suppressed.listing_id
    )
    or (
      exists (
        select 1 from listing_suppression.entries e
        where e.kind = 'lookalike' and e.basis = 'description' and e.expires_at > now()
      )
      and exists (
        select 1
        from detail_evidence.v_fingerprints f
        join listing_suppression.entries e
          on e.kind = 'lookalike' and e.basis = 'description' and e.value = f.fingerprint
         and e.expires_at > now()
        where f.listing_id = is_suppressed.listing_id
      )
    )
$$;

revoke all on listing_suppression.v_suppressed from public, anon, authenticated;
grant select on listing_suppression.v_suppressed to nabvy_pipeline;

revoke all on function listing_suppression.listing_hash(text, text) from public;
grant execute on function listing_suppression.listing_hash(text, text) to nabvy_pipeline;
revoke all on function listing_suppression.is_suppressed(uuid) from public;
grant execute on function listing_suppression.is_suppressed(uuid) to nabvy_app, nabvy_pipeline;
