-- pasted-link-lookup: grants, RLS, views. Hand-written (packages/db/README.md). Depends on core
-- (uuidv7, track_updated_at, RLS/pipeline helpers), switches (switches.state/is_on),
-- listing-card (the `app` schema and app.v_listing_card, which the module reads to answer) and,
-- through listing-card, listing-suppression (is_suppressed). Nothing here is destructive.
comment on schema pasted_link_lookup is
  'Pasted-link lookup: a user''s request for a Marketplace listing''s card, answered from the shared pipeline. Owner: the pasted-link-lookup module.';
grant usage on schema pasted_link_lookup to nabvy_app, nabvy_pipeline;

-- requests: inserted by the web app inside withUser (submit(), services/pasted-link-lookup/src/
-- index.ts) and moved on by the pipeline's settle tick (ready, failed) or purged on
-- account.deleted (rule 12 of docs/design/modules/_rules.md). The app never updates or deletes:
-- a request's later states are the pipeline's to write. RLS scopes every app statement to the
-- caller's own rows; the restrictive policy below limits what the app may insert to a fresh
-- request stamped with server time, so no caller picks a requested_at (which drives the daily
-- limit and the expiry) or a ready_at, and none records a failure. Both columns are
-- timestamptz(3), so the comparison rounds now() to the same precision.
select nabvy_core.enable_user_rls('pasted_link_lookup.requests');
grant select, insert on pasted_link_lookup.requests to nabvy_app;
create policy app_submits_only on pasted_link_lookup.requests as restrictive for insert to nabvy_app
  with check (
    status in ('queued', 'ready')
    and outcome is null
    and requested_at = now()::timestamptz(3)
    and (ready_at is null or ready_at = now()::timestamptz(3))
  );
select nabvy_core.allow_pipeline('pasted_link_lookup.requests', 'select');
select nabvy_core.allow_pipeline('pasted_link_lookup.requests', 'update');
select nabvy_core.allow_pipeline('pasted_link_lookup.requests', 'delete');
grant select, update, delete on pasted_link_lookup.requests to nabvy_pipeline;
select nabvy_core.track_updated_at('pasted_link_lookup.requests');

-- Internal: requests per user per UTC day, for account-integrity (module card, "Views"). Rows
-- while the switch is shadow or on (rule 11). Carries a user ID, so never granted to nabvy_app.
create view pasted_link_lookup.v_request_counts with (security_invoker = true) as
  select user_id, (requested_at at time zone 'utc')::date as day, count(*) as n
  from pasted_link_lookup.requests
  where switches.state('pasted-link-lookup') <> 'off'
  group by user_id, (requested_at at time zone 'utc')::date;
revoke all on pasted_link_lookup.v_request_counts from public;
grant select on pasted_link_lookup.v_request_counts to nabvy_pipeline;

-- User-facing: the caller's own requests (RLS through security_invoker over the module's own
-- table), only while the switch is on (rule 11). Explicit column list; no seller field and no
-- field of the listing itself (the card is read through app.v_listing_card by listing_id), and
-- never the failure outcome. A request whose listing is suppressed is left out, as rule 5
-- requires of every view that shows listings; listing_suppression.is_suppressed() is SECURITY
-- DEFINER and already granted to nabvy_app. The `app` schema exists from listing-card's
-- migration, which module.json orders before this one.
create view app.v_pasted_link_lookup_requests with (security_invoker = true) as
  select id as request_id, source, source_listing_id, listing_id, status, requested_at, ready_at
  from pasted_link_lookup.requests
  where switches.is_on('pasted-link-lookup')
    and switches.is_on('listing-suppression')
    and (listing_id is null or not listing_suppression.is_suppressed(listing_id));
revoke all on app.v_pasted_link_lookup_requests from public, anon, authenticated;
grant select on app.v_pasted_link_lookup_requests to nabvy_app;
