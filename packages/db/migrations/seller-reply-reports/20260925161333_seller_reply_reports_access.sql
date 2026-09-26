-- seller-reply-reports: grants, RLS, views. Hand-written (packages/db/README.md). Depends on core
-- (uuidv7, track_updated_at, RLS/pipeline helpers), switches (switches.state/is_on) and
-- listing-suppression (is_suppressed, for the user-facing view).
comment on schema seller_reply_reports is
  'Seller-reply reports: one-tap reports of what a seller told a buyer, and the evidence they add up to. Owner: the seller-reply-reports module.';
grant usage on schema seller_reply_reports to nabvy_app, nabvy_pipeline;

-- reports: the web app inserts the caller's own report inside withUser (submit()) and may only
-- withdraw it afterwards; it never writes eligibility, weights, status other than 'withdrawn', or
-- the outcome: the pipeline's aggregator and resolve() do (services/seller-reply-reports/README.md).
-- Column grants keep the internal columns (eligibility, weights, outcome) out of the app role's
-- reach even for its own rows: the reporter sees only the coarse status, through the app view.
select nabvy_core.enable_user_rls('seller_reply_reports.reports', 'reporter_user_id');
grant select (id, source, listing_id, reporter_user_id, status, created_at, updated_at, withdrawn_at)
  on seller_reply_reports.reports to nabvy_app;
grant insert (source, listing_id, reporter_user_id, card_hash, evidence_hash, open_via,
  first_opened_at, listing_shipping_offered, listing_checkout_enabled, listing_messaging_enabled,
  rule_version)
  on seller_reply_reports.reports to nabvy_app;
grant update (status, withdrawn_at) on seller_reply_reports.reports to nabvy_app;
-- An app update is a withdrawal and nothing else.
create policy app_withdraw_only on seller_reply_reports.reports as restrictive for update
  to nabvy_app
  using (true)
  with check (status = 'withdrawn' and withdrawn_at is not null);
select nabvy_core.allow_pipeline('seller_reply_reports.reports', 'select');
select nabvy_core.allow_pipeline('seller_reply_reports.reports', 'update');
select nabvy_core.allow_pipeline('seller_reply_reports.reports', 'delete');
grant select, update, delete on seller_reply_reports.reports to nabvy_pipeline;
select nabvy_core.track_updated_at('seller_reply_reports.reports');

-- report_reasons: no user column of its own; the app sees and writes only the reasons of reports
-- RLS lets it see (its own). The aggregator fills distance_band and counts.
alter table seller_reply_reports.report_reasons enable row level security;
create policy app_own_report on seller_reply_reports.report_reasons for all to nabvy_app
  using (exists (select 1 from seller_reply_reports.reports r where r.id = report_id))
  with check (exists (select 1 from seller_reply_reports.reports r where r.id = report_id));
grant select (id, report_id, reason, detail, second_answer, reported_place_id)
  on seller_reply_reports.report_reasons to nabvy_app;
grant insert (report_id, reason, detail, second_answer, reported_place_id)
  on seller_reply_reports.report_reasons to nabvy_app;
grant delete on seller_reply_reports.report_reasons to nabvy_app;
select nabvy_core.allow_pipeline('seller_reply_reports.report_reasons', 'select');
select nabvy_core.allow_pipeline('seller_reply_reports.report_reasons', 'update');
select nabvy_core.allow_pipeline('seller_reply_reports.report_reasons', 'delete');
grant select, update, delete on seller_reply_reports.report_reasons to nabvy_pipeline;
select nabvy_core.track_updated_at('seller_reply_reports.report_reasons');

-- reporter_stats: pipeline only; RLS on user_id like every table with a user ID, with no app grant.
select nabvy_core.enable_user_rls('seller_reply_reports.reporter_stats');
select nabvy_core.allow_pipeline('seller_reply_reports.reporter_stats', 'all');
grant select, insert, update, delete on seller_reply_reports.reporter_stats to nabvy_pipeline;
select nabvy_core.track_updated_at('seller_reply_reports.reporter_stats');

-- testers: written by the admin path through the pipeline role (addTesters()); the app reads only
-- the caller's own row, which the user-facing view uses to show "Your reports" in shadow.
select nabvy_core.enable_user_rls('seller_reply_reports.testers');
grant select (user_id) on seller_reply_reports.testers to nabvy_app;
select nabvy_core.allow_pipeline('seller_reply_reports.testers', 'all');
grant select, insert, update, delete on seller_reply_reports.testers to nabvy_pipeline;
select nabvy_core.track_updated_at('seller_reply_reports.testers');

-- listing_evidence and holds: pipeline tables, no user ID.
select nabvy_core.allow_pipeline('seller_reply_reports.listing_evidence', 'all');
grant select, insert, update, delete on seller_reply_reports.listing_evidence to nabvy_pipeline;
select nabvy_core.track_updated_at('seller_reply_reports.listing_evidence');
select nabvy_core.allow_pipeline('seller_reply_reports.holds', 'all');
grant select, insert, update, delete on seller_reply_reports.holds to nabvy_pipeline;
select nabvy_core.track_updated_at('seller_reply_reports.holds');

-- Internal: the evidence per listing, family and scope, for suspected-labels, ops-metrics and
-- review-console. No user ID, no free text; people are banded (never an exact count under 10,
-- docs/decisions.md:15; SELLER_REPLY_REPORTS_EXACT_COUNT_FROM). Rows while shadow or on (rule 11).
create view seller_reply_reports.v_listing_evidence with (security_invoker = true) as
  select listing_id, source, family, scope,
    case when persons = 0 then 'none' when persons = 1 then 'one'
         when persons < 10 then 'several' else 'exact' end as persons_band,
    case when persons >= 10 then persons end as persons_exact,
    level, place_id, distance_band, held, hold_reason, carried_from_relist, rule_version, as_of
  from seller_reply_reports.listing_evidence
  where switches.state('seller-reply-reports') <> 'off';
revoke all on seller_reply_reports.v_listing_evidence from public;
grant select on seller_reply_reports.v_listing_evidence to nabvy_pipeline;

-- Internal: one row per report for review-console, no user ID (design §6.2).
create view seller_reply_reports.v_review_items with (security_invoker = true) as
  select r.id as report_id, r.listing_id,
    coalesce(array_agg(rr.reason order by rr.reason) filter (where rr.id is not null), '{}') as reasons,
    coalesce(array_agg(coalesce(rr.detail, '') order by rr.reason) filter (where rr.id is not null), '{}') as details,
    coalesce(array_agg(coalesce(rr.second_answer, '') order by rr.reason) filter (where rr.id is not null), '{}') as second_answers,
    r.note_text, r.eligibility, r.weight, r.status
  from seller_reply_reports.reports r
  left join seller_reply_reports.report_reasons rr on rr.report_id = r.id
  where switches.state('seller-reply-reports') <> 'off'
  group by r.id;
revoke all on seller_reply_reports.v_review_items from public;
grant select on seller_reply_reports.v_review_items to nabvy_pipeline;

-- Internal: daily shadow rates for ops-metrics (design §5.2), no user ID.
create view seller_reply_reports.v_shadow_metrics with (security_invoker = true) as
  select to_char(d.day, 'YYYY-MM-DD') as day,
    (select count(*)::int from seller_reply_reports.reports r where (r.created_at at time zone 'utc')::date = d.day) as reports,
    (select count(*)::int from seller_reply_reports.reports r where (r.created_at at time zone 'utc')::date = d.day and r.eligibility = 'eligible') as eligible,
    (select count(*)::int from seller_reply_reports.reports r
       join seller_reply_reports.report_reasons rr on rr.report_id = r.id and rr.reason = 'as_listed'
       where (r.created_at at time zone 'utc')::date = d.day) as counter_reports,
    (select count(*)::int from seller_reply_reports.reports r where (r.created_at at time zone 'utc')::date = d.day and r.withdrawn_at is not null) as withdrawn,
    (select count(*)::int from seller_reply_reports.reports r where (r.created_at at time zone 'utc')::date = d.day and r.eligibility = 'rate_limited') as rate_limited,
    (select count(distinct e.listing_id)::int from seller_reply_reports.listing_evidence e where (e.as_of at time zone 'utc')::date = d.day and e.held) as held_listings
  from (select distinct (created_at at time zone 'utc')::date as day from seller_reply_reports.reports) d
  where switches.state('seller-reply-reports') <> 'off';
revoke all on seller_reply_reports.v_shadow_metrics from public;
grant select on seller_reply_reports.v_shadow_metrics to nabvy_pipeline;

-- Internal: reporter signals for account-integrity and the admin path only (design §6.2). No
-- report-then-buy count (not an abuse signal, §3.3) and no seller data, so not restricted_.
-- Until per-module roles exist it is granted to nabvy_pipeline, never to nabvy_app (rule 4).
create view seller_reply_reports.v_reporter_signals with (security_invoker = true) as
  select r.reporter_user_id as user_id,
    count(*) filter (where r.created_at > now() - interval '24 hours')::int as reports_24h,
    count(*) filter (where r.created_at > now() - interval '30 days')::int as reports_30d,
    coalesce(max(s.not_upheld), 0)::int as not_upheld,
    coalesce(max(s.voided), 0)::int as voided,
    count(*) filter (where r.eligibility = 'rate_limited')::int as over_limit,
    count(*) filter (where r.eligibility = 'burst_hold')::int as burst_involvement
  from seller_reply_reports.reports r
  left join seller_reply_reports.reporter_stats s on s.user_id = r.reporter_user_id
  where switches.state('seller-reply-reports') <> 'off'
  group by r.reporter_user_id;
revoke all on seller_reply_reports.v_reporter_signals from public;
grant select on seller_reply_reports.v_reporter_signals to nabvy_pipeline;

-- User-facing (docs/security.md, "Cross-module reads behind a user-facing view": this view reads
-- only this module's own RLS tables, so it needs no SECURITY DEFINER function). The caller's own
-- reports, through RLS and security_invoker, with the coarse status only: never eligibility,
-- weight, hold or outcome (design §6.4). Rows while the switch is on; in shadow, to testers only
-- (design §6.2, "Shadow"). A suppressed listing never shows, and nothing shows while
-- listing-suppression is off (rules 5 and 11).
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to nabvy_app;

create view app.v_seller_reply_reports_mine with (security_invoker = true) as
  select r.id as report_id, r.listing_id,
    array(select rr.reason from seller_reply_reports.report_reasons rr
          where rr.report_id = r.id order by rr.reason) as reasons,
    r.status, r.created_at, (r.withdrawn_at is null) as withdrawable
  from seller_reply_reports.reports r
  where (switches.is_on('seller-reply-reports')
         or (switches.state('seller-reply-reports') = 'shadow'
             and exists (select 1 from seller_reply_reports.testers t
                         where t.user_id = nabvy_core.current_user_id())))
    and switches.is_on('listing-suppression')
    and not listing_suppression.is_suppressed(r.listing_id);
revoke all on app.v_seller_reply_reports_mine from public;
grant select on app.v_seller_reply_reports_mine to nabvy_app;
