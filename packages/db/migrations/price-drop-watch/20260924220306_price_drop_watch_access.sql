-- Access, RLS, internal grants and the user-facing views for the price_drop_watch schema
-- (packages/db/README.md, "Adding tables to a module"; services/price-drop-watch/README.md).
-- Depends on core (uuidv7, RLS helpers), switches (switches.is_on), listing-ingest (v_listings,
-- v_price_changes), listing-suppression (is_suppressed) — module.json orders this after all of
-- them.
--
-- price-drop-watch is the first module to publish a user-facing `app.*` view (no module has
-- created the `app` schema yet: services/account/README.md, "Decisions"). `create schema if not
-- exists` and plain `grant`s are idempotent, so a second module's migration doing the same in a
-- parallel wave is a no-op, never a conflict.
create schema if not exists app;
comment on schema app is
  'Nabvy: user-facing views only (rule 5 of docs/design/modules/_rules.md), one v_<module>_<name> per module. Never exposed to the Data API directly; read through oRPC.';
revoke all on schema app from public;

comment on schema price_drop_watch is
  'Price-drop watch: a user''s watched listings and the price drops observed on them, within one listing ID each. Owner: the price-drop-watch module.';
grant usage on schema price_drop_watch to nabvy_app, nabvy_pipeline;
-- Schema app is the user-facing surface only (docs/security.md, "Cross-module reads behind a
-- user-facing view"): nabvy_pipeline, and any cross-user or admin read, uses the internal views
-- with their own grants and never gets execute/select on this module's own views in app.
grant usage on schema app to nabvy_app;

-- watch()'s own existence check ("is this a real listing-ingest listing?") reads
-- listing_ingest.v_listings, an internal view (rule 5) granted only to nabvy_pipeline, but
-- watch() itself runs as nabvy_app (withUser). Wrapped the same way as
-- listing_price_history() below: a SECURITY DEFINER function nabvy_app may call. A boolean
-- predicate over one opaque ID needs no user scope (docs/security.md); nabvy_pipeline gets no
-- execute because no pipeline code calls it (the pipeline reads listing_ingest.v_listings itself).
create function price_drop_watch.listing_known(p_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from listing_ingest.v_listings l where l.id = p_listing_id)
$$;
revoke all on function price_drop_watch.listing_known(uuid) from public;
grant execute on function price_drop_watch.listing_known(uuid) to nabvy_app;

-- watches: the user's own row (create, unwatch). The pipeline reads every watch to schedule
-- rechecks and to find watches on listings a batch of events touches; it never writes one.
grant select, insert, update on price_drop_watch.watches to nabvy_app;
select nabvy_core.enable_user_rls('price_drop_watch.watches');
select nabvy_core.allow_pipeline('price_drop_watch.watches', 'select');
select nabvy_core.allow_pipeline('price_drop_watch.watches', 'delete');
grant select, delete on price_drop_watch.watches to nabvy_pipeline;
select nabvy_core.track_updated_at('price_drop_watch.watches');

-- drops: written only by the pipeline (the card-changed and merged handlers); the user never
-- writes one directly, only reads through the history view.
select nabvy_core.allow_pipeline('price_drop_watch.drops', 'select');
select nabvy_core.allow_pipeline('price_drop_watch.drops', 'insert');
select nabvy_core.allow_pipeline('price_drop_watch.drops', 'delete');
grant select, insert, delete on price_drop_watch.drops to nabvy_pipeline;

-- User-facing views (rule 5): an explicit column list, security_invoker so RLS on `watches`
-- scopes every row to the caller, gated on this module's own switch (rule 11) and on
-- listing-suppression's (a view of listings always adds `and switches.is_on('listing-suppression')`
-- and anti-joins `is_suppressed()`, so an off or unreachable suppression module hides every
-- listing rather than showing suppressed ones again).

create view app.v_price_drop_watch_watches with (security_invoker = true) as
  select w.id, w.listing_id, w.active, w.created_at
  from price_drop_watch.watches w
  where switches.is_on('price-drop-watch')
    and switches.is_on('listing-suppression')
    and not listing_suppression.is_suppressed(w.listing_id);
revoke all on app.v_price_drop_watch_watches from public;
grant select on app.v_price_drop_watch_watches to nabvy_app;

-- History: the watched listing's own observed prices only (listing-ingest's sightings), never the
-- seller's displayed "previous price" and never a number this module invents. One listing ID per
-- row set (rule 5's card: "It never shows history across listing IDs"): each row's `listing_id` is
-- read straight from the watch, never followed through a relist-merge group. The anchor row is the
-- listing's first fetched price; every later row is one of listing-ingest's recorded price changes.
--
-- listing-ingest's v_listings and v_price_changes are internal views (rule 5), granted only to
-- nabvy_pipeline until per-module roles exist. A security_invoker view queried by nabvy_app cannot
-- reach them directly, so the read is wrapped in a SECURITY DEFINER function, owned by the
-- migration role and callable by nabvy_app, exactly as listing_suppression.is_suppressed() wraps
-- its own cross-module reads. The outer view stays security_invoker and touches only this
-- module's own `watches`, so RLS still scopes every row to the caller.
--
-- The function's owner bypasses RLS, so its body is the guard (docs/security.md, "Cross-module
-- reads behind a user-facing view"): it returns rows only when the caller has an active watch on
-- that listing, checked as nabvy_core.current_user_id() against this module's own `watches`. A
-- call outside withUser (no app.user_id) or for a listing the caller does not watch returns
-- nothing. Row-returning, so nabvy_pipeline gets no execute: the pipeline reads
-- listing_ingest.v_price_changes directly with its own grants.
create function price_drop_watch.listing_price_history(p_listing_id uuid)
returns table (observed_at timestamptz, price_minor bigint, currency text)
language sql
stable
security definer
set search_path = ''
as $$
  with watched as (
    select 1
    from price_drop_watch.watches w
    where w.listing_id = p_listing_id
      and w.active
      and w.user_id = nabvy_core.current_user_id()
  ),
  anchor as (
    select l.first_fetched_at as observed_at, l.price_minor, l.currency
    from listing_ingest.v_listings l
    where l.id = p_listing_id and l.price_minor is not null
  ),
  changes as (
    select pc.seen_at as observed_at, pc.price_minor, pc.currency
    from listing_ingest.v_price_changes pc
    where pc.listing_id = p_listing_id
  )
  select h.observed_at, h.price_minor, h.currency
  from (
    select observed_at, price_minor, currency from anchor
    union all
    select observed_at, price_minor, currency from changes
  ) h
  where exists (select 1 from watched)
$$;
revoke all on function price_drop_watch.listing_price_history(uuid) from public;
grant execute on function price_drop_watch.listing_price_history(uuid) to nabvy_app;

create view app.v_price_drop_watch_history with (security_invoker = true) as
  select w.listing_id, h.observed_at, h.price_minor, h.currency
  from price_drop_watch.watches w
  cross join lateral price_drop_watch.listing_price_history(w.listing_id) h
  where w.active
    and switches.is_on('price-drop-watch')
    and switches.is_on('listing-suppression')
    and not listing_suppression.is_suppressed(w.listing_id);
revoke all on app.v_price_drop_watch_history from public;
grant select on app.v_price_drop_watch_history to nabvy_app;
