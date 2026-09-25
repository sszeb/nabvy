-- listing-feedback: grants, RLS, views. Hand-written (packages/db/README.md). Depends on core
-- (uuidv7, track_updated_at, RLS/pipeline helpers), switches (switches.state/is_on) and
-- listing-suppression (is_suppressed).
comment on schema listing_feedback is
  'Listing feedback: a user''s verdict and saved/dismissed state on a listing. Owner: the listing-feedback module.';
grant usage on schema listing_feedback to nabvy_app, nabvy_pipeline;

-- verdicts and listing_state: written entirely by the web app inside withUser (recordVerdict()
-- and setState(), services/listing-feedback/src/index.ts). Neither needs cost-meter or another
-- pipeline-only read, so unlike scan-recognition this module never writes as nabvy_pipeline.
-- Each row is upserted on its identity index (packages/db/src/schema/listing-feedback.ts), so
-- nabvy_app needs update as well as insert. The pipeline only purges a deleted account's rows
-- (account.deleted, rule 12 of docs/design/modules/_rules.md) and reads for the internal views
-- below.
select nabvy_core.enable_user_rls('listing_feedback.verdicts');
grant select, insert, update on listing_feedback.verdicts to nabvy_app;
select nabvy_core.allow_pipeline('listing_feedback.verdicts', 'select');
select nabvy_core.allow_pipeline('listing_feedback.verdicts', 'delete');
grant select, delete on listing_feedback.verdicts to nabvy_pipeline;
select nabvy_core.track_updated_at('listing_feedback.verdicts');

select nabvy_core.enable_user_rls('listing_feedback.listing_state');
grant select, insert, update on listing_feedback.listing_state to nabvy_app;
select nabvy_core.allow_pipeline('listing_feedback.listing_state', 'select');
select nabvy_core.allow_pipeline('listing_feedback.listing_state', 'delete');
grant select, delete on listing_feedback.listing_state to nabvy_pipeline;
select nabvy_core.track_updated_at('listing_feedback.listing_state');

-- Internal: verdicts per alert, day and verdict, with no user ID (rule 5; an alert precision
-- guardrail metric, docs/decisions.md:236, and the review loop). Rows while the switch is shadow
-- or on (rule 11); no user-facing counterpart.
create view listing_feedback.v_verdict_counts with (security_invoker = true) as
  select alert_id, (at at time zone 'utc')::date as day, verdict, count(*) as n
  from listing_feedback.verdicts
  where switches.state('listing-feedback') <> 'off'
  group by alert_id, (at at time zone 'utc')::date, verdict;
revoke all on listing_feedback.v_verdict_counts from public;
grant select on listing_feedback.v_verdict_counts to nabvy_pipeline;

-- Internal, meant only for seller-reply-reports (docs/design/modules/listing-feedback.md,
-- "Views"): a bought verdict, for the report-then-buy abuse exemption (too-good-to-be-true
-- design §3.3, §6.1, task 1.7s). It carries a user ID but no seller field, so it is the plain
-- internal class of rule 5, not restricted_; until per-module roles exist every internal view is
-- granted to nabvy_pipeline broadly (rule 4), and a conventions test limits which package may
-- import it.
create view listing_feedback.v_bought_for_reports with (security_invoker = true) as
  select user_id, listing_id, at
  from listing_feedback.verdicts
  where verdict = 'bought' and switches.state('listing-feedback') <> 'off';
revoke all on listing_feedback.v_bought_for_reports from public;
grant select on listing_feedback.v_bought_for_reports to nabvy_pipeline;

-- User-facing: the caller's own feedback (RLS through security_invoker), only while the switch
-- is on (rule 11). Explicit column list; no seller field and no field of the listing itself, only
-- the user's own action. A row whose listing is suppressed is left out, as rule 5 requires of
-- every view that shows listings. It lives in this module's schema, not `app.*`, because no
-- `app` schema exists yet (the same gap services/account/README.md and services/scan-recognition/
-- README.md record for their own modules); move it once the web app's oRPC layer creates `app`.
create view listing_feedback.v_listing_feedback_mine with (security_invoker = true) as
  select listing_id, alert_id, verdict, null::text as state, at
  from listing_feedback.verdicts
  where switches.is_on('listing-feedback')
    and not listing_suppression.is_suppressed(listing_id)
  union all
  select listing_id, null::uuid as alert_id, null::text as verdict, state, at
  from listing_feedback.listing_state
  where switches.is_on('listing-feedback')
    and not listing_suppression.is_suppressed(listing_id);
revoke all on listing_feedback.v_listing_feedback_mine from public;
grant select on listing_feedback.v_listing_feedback_mine to nabvy_app;
