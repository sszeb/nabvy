-- Access, views and functions for the copy_advert schema (packages/db/README.md, "Adding tables
-- to a module"; services/copy-advert/README.md; docs/design/drafts/copy-advert.md 5.1-5.2).
-- Depends on core (uuidv7, track_updated_at, view_violations), switches (state, is_on),
-- listing-ingest (v_listings), listing-suppression (is_suppressed), city-pages (v_city_pages).
--
-- All nine tables are pipeline data (no per-user writes except `reports`), so only nabvy_pipeline
-- writes them. Every internal view filters on switches.state('copy-advert') <> 'off' (rule 11:
-- shadow behaves like on for internal readers; off returns no rows). `flags` also carries a direct
-- nabvy_app grant and RLS policy, because the user-facing app.v_copy_advert_flags view is deferred
-- to task 1.7c (the `app` schema does not exist yet; services/copy-advert/README.md, "Decisions",
-- as services/account/README.md made the same choice).

grant usage on schema copy_advert to nabvy_pipeline, nabvy_app;

-- Pipeline-only tables: no user rows, no RLS.
grant select, insert, update, delete on copy_advert.prints to nabvy_pipeline;
grant select, insert, update, delete on copy_advert.links to nabvy_pipeline;
grant select, insert, update, delete on copy_advert.photo_matches to nabvy_pipeline;
grant select, insert, update, delete on copy_advert.clusters to nabvy_pipeline;
grant select, insert, update, delete on copy_advert.members to nabvy_pipeline;
grant select, insert, update, delete on copy_advert.candidate_requests to nabvy_pipeline;
grant select, insert, update, delete on copy_advert.overrides to nabvy_pipeline;
grant select, insert on copy_advert.account_checks to nabvy_pipeline;

select nabvy_core.track_updated_at('copy_advert.prints');
select nabvy_core.track_updated_at('copy_advert.links');
select nabvy_core.track_updated_at('copy_advert.photo_matches');
select nabvy_core.track_updated_at('copy_advert.clusters');
select nabvy_core.track_updated_at('copy_advert.members');
select nabvy_core.track_updated_at('copy_advert.candidate_requests');
select nabvy_core.track_updated_at('copy_advert.overrides');
select nabvy_core.track_updated_at('copy_advert.account_checks');
select nabvy_core.track_updated_at('copy_advert.reports');

-- The near-duplicate description index (4.5): GIN trigram over the normalised, full_verified
-- description of the current print only. pg_trgm is installed with the core migration.
create index prints_trgm_idx on copy_advert.prints using gin (desc_norm extensions.gin_trgm_ops)
  where current and desc_norm is not null;

-- `reports`: user rows. A user reads and writes their own report; the pipeline reads every report
-- for v_review_queue and to purge a deleted user's rows.
select nabvy_core.enable_user_rls('copy_advert.reports');
grant select, insert on copy_advert.reports to nabvy_app;
select nabvy_core.allow_pipeline('copy_advert.reports', 'select');
select nabvy_core.allow_pipeline('copy_advert.reports', 'delete');
grant select, delete on copy_advert.reports to nabvy_pipeline;

-- `flags`: every active member of every active cluster gets a row (a broader population than the
-- schema sketch's "one per listing in a mass-posted cluster": `would_show` already carries the
-- mass-posted and threshold gate, so internal readers of v_listing_copy_facts see every clustered
-- listing, not only the ones a user could ever be shown; services/copy-advert/README.md,
-- "Decisions"). It carries a direct RLS policy and column grant, standing in for
-- app.v_copy_advert_flags until the `app` schema and task 1.7c's owner sign-off and legal review.
alter table copy_advert.flags enable row level security;
create policy nabvy_app_read on copy_advert.flags for select to nabvy_app
  using (
    would_show
    and corrected is null
    and switches.state('copy-advert') = 'on'
    and switches.is_on('listing-suppression')
    and not listing_suppression.is_suppressed(listing_id)
  );
select nabvy_core.allow_pipeline('copy_advert.flags', 'select');
select nabvy_core.allow_pipeline('copy_advert.flags', 'insert');
select nabvy_core.allow_pipeline('copy_advert.flags', 'update');
select nabvy_core.allow_pipeline('copy_advert.flags', 'delete');
grant select, insert, update, delete on copy_advert.flags to nabvy_pipeline;
grant select (listing_id, towns, span_days, rule_version) on copy_advert.flags to nabvy_app;

-- Internal views (rule 5). security_invoker so RLS still applies; empty while the module is off.

create view copy_advert.v_members with (security_invoker = true) as
select m.cluster_key, m.listing_id, m.source_listing_id, m.city_page_id, m.basis, m.joined_at,
       c.member_set_hash
from copy_advert.members m
join copy_advert.clusters c on c.cluster_key = m.cluster_key and c.status = 'active'
where m.left_at is null and switches.state('copy-advert') <> 'off';

create view copy_advert.v_cluster_facts with (security_invoker = true) as
select cluster_key, listing_count, town_count, span_days, spread_km, price_minor, currency,
       mass_posted, rule_version, as_of
from copy_advert.clusters
where status = 'active' and switches.state('copy-advert') <> 'off';

create view copy_advert.v_listing_copy_facts with (security_invoker = true) as
select
  f.listing_id,
  f.cluster_key,
  greatest(c.listing_count - 1, 0) as other_listings,
  f.towns,
  f.span_days,
  c.spread_km,
  c.mass_posted,
  (f.would_show and f.corrected is null) as would_show,
  f.rule_version,
  coalesce((
    select count(*) from copy_advert.links l
    where l.basis = 'text_copy' and (l.listing_a = f.listing_id or l.listing_b = f.listing_id)
  ), 0)::int as text_copy_count
from copy_advert.flags f
join copy_advert.clusters c on c.cluster_key = f.cluster_key and c.status = 'active'
where switches.state('copy-advert') <> 'off';

create view copy_advert.v_links with (security_invoker = true) as
select listing_a, listing_b, basis, similarity, photo_id_match, decided_at
from copy_advert.links
where switches.state('copy-advert') <> 'off';

-- Every active cluster is unreviewed: there is no review-console yet to record a hand check
-- (services/copy-advert/README.md, "Decisions").
create view copy_advert.v_review_queue with (security_invoker = true) as
select cluster_key, listing_count, town_count, mass_posted, as_of, null::timestamptz as last_checked_at
from copy_advert.clusters
where status = 'active' and switches.state('copy-advert') <> 'off';

-- Daily shadow metrics, keyed by the day prints were written. active_clusters, active_members and
-- flags_would_show are today's totals repeated on every day row: there is no daily snapshot table,
-- a starting-value simplification for this ops view (services/copy-advert/README.md, "Decisions").
create view copy_advert.v_shadow_metrics with (security_invoker = true) as
with days as (
  select distinct date(done_at) as day from copy_advert.prints
)
select
  to_char(d.day, 'YYYY-MM-DD') as day,
  (select count(*)::int from copy_advert.clusters c where date(c.created_at) = d.day) as clusters_formed,
  (select count(*)::int from copy_advert.clusters c where c.status = 'active') as active_clusters,
  (select count(*)::int from copy_advert.members m where m.left_at is null) as active_members,
  (select count(*)::int from copy_advert.candidate_requests r where date(r.requested_at) = d.day) as candidates_requested,
  (select count(*)::int from copy_advert.candidate_requests r where date(r.resolved_at) = d.day) as candidates_resolved,
  (select count(*)::int from copy_advert.flags f where f.would_show and f.corrected is null) as flags_would_show,
  (select count(*)::int from copy_advert.links l where l.basis = 'lookalike' and date(l.decided_at) = d.day) as lookalike_splits,
  (select count(*)::int from copy_advert.photo_matches p where date(p.found_at) = d.day) as photo_id_matches,
  (select count(*)::int from copy_advert.reports r where date(r.at) = d.day) as reports
from days d
where switches.state('copy-advert') <> 'off';

grant select on
  copy_advert.v_members,
  copy_advert.v_cluster_facts,
  copy_advert.v_listing_copy_facts,
  copy_advert.v_links,
  copy_advert.v_review_queue,
  copy_advert.v_shadow_metrics
to nabvy_pipeline;

-- Restricted (5.2): never `v_`-named, never granted to nabvy_app (packages/db/README.md, "Views").
-- Empty until seller-key exists and S7 is built (1.7d).
create view copy_advert.restricted_accounts with (security_invoker = true) as
select cluster_key, run_id, spans_accounts, checked_at from copy_advert.account_checks;
grant select on copy_advert.restricted_accounts to nabvy_pipeline;

revoke all on schema copy_advert from anon, authenticated;
