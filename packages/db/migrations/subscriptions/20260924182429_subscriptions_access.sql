-- subscriptions: grants, RLS and the two internal views. Hand-written (packages/db/README.md).
--
-- Who writes what (services/subscriptions/README.md, "Tables"):
--   * everything is written by the pipeline only: Stripe webhooks and the allowance sweep run in
--     withPipeline. The web app may read its own entitlement (the user's plan) and its own
--     customer link (top-up Checkout), and nothing else;
--   * billing_events is append-only: no role may update or delete it (a failed event writes
--     nothing and Stripe retries it), so the stored consent cannot be changed after the payment;
--   * v_billing_signals is internal only: granted to nabvy_pipeline, never to nabvy_app, and no
--     user-facing view may read it (packages/db/tests/subscriptions.test.sql).
comment on schema subscriptions is
  'Subscriptions: Stripe subscriptions turned into entitlements, billing events and consent. Owner: the subscriptions module.';
grant usage on schema subscriptions to nabvy_app, nabvy_pipeline;

-- entitlements: the pipeline writes; the web app reads the signed-in user's own row.
grant select on subscriptions.entitlements to nabvy_app;
select nabvy_core.enable_user_rls('subscriptions.entitlements');
select nabvy_core.allow_pipeline('subscriptions.entitlements', 'all');
grant select, insert, update, delete on subscriptions.entitlements to nabvy_pipeline;
select nabvy_core.track_updated_at('subscriptions.entitlements');

-- customers: Stripe customer → user, learned from webhooks, written by the pipeline only and
-- never updated, so a customer can never be moved to another user. The web app reads the
-- signed-in user's own link, to open a top-up Checkout on the right customer.
grant select on subscriptions.customers to nabvy_app;
select nabvy_core.enable_user_rls('subscriptions.customers');
select nabvy_core.allow_pipeline('subscriptions.customers', 'select');
select nabvy_core.allow_pipeline('subscriptions.customers', 'insert');
grant select, insert on subscriptions.customers to nabvy_pipeline;

-- billing_events: pipeline select and insert only.
select nabvy_core.enable_user_rls('subscriptions.billing_events');
select nabvy_core.allow_pipeline('subscriptions.billing_events', 'select');
select nabvy_core.allow_pipeline('subscriptions.billing_events', 'insert');
grant select, insert on subscriptions.billing_events to nabvy_pipeline;

-- Refuse update and delete on billing_events even for the owner: consent is evidence.
create or replace function subscriptions.refuse_billing_event_change() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'subscriptions: billing_events is append-only' using errcode = '42501';
end;
$$;
revoke all on function subscriptions.refuse_billing_event_change() from public;
create trigger billing_events_append_only before update or delete on subscriptions.billing_events
  for each row execute function subscriptions.refuse_billing_event_change();
create trigger billing_events_no_truncate before truncate on subscriptions.billing_events
  for each statement execute function subscriptions.refuse_billing_event_change();

-- Internal: each user's entitlement. Exempt from the switch filter (rule 11 names it): it always
-- returns its rows, so readers never mistake "module off" for "Free".
create view subscriptions.v_entitlements with (security_invoker = true) as
  select e.user_id, e.tier, e.status, e.areas, e.wants, e.channels,
         e.base_cadence_seconds, e.floor_cadence_seconds, e.period_end,
         e.cancel_at_period_end, e.trial_end, e.policy_version, e.updated_at
  from subscriptions.entitlements as e;
grant select on subscriptions.v_entitlements to nabvy_pipeline;

-- Internal only, never user-facing: failed payments, chargebacks and card fingerprints per user,
-- for account-integrity's ban-evasion check (card). Rows only while the module is not off.
create view subscriptions.v_billing_signals with (security_invoker = true) as
  select b.user_id,
         (count(*) filter (where b.signal = 'payment_failed'))::integer as failed_payments,
         (count(*) filter (where b.signal = 'dispute'))::integer as disputes,
         max(b.stripe_created_at) filter (where b.signal = 'payment_failed') as last_failed_payment_at,
         max(b.stripe_created_at) filter (where b.signal = 'dispute') as last_dispute_at,
         coalesce(
           array_agg(distinct b.card_fingerprint order by b.card_fingerprint)
             filter (where b.card_fingerprint is not null),
           '{}'::text[]
         ) as card_fingerprints
  from subscriptions.billing_events as b
  where b.user_id is not null
    and (b.signal is not null or b.card_fingerprint is not null)
    and switches.state('subscriptions') <> 'off'
  group by b.user_id;
grant select on subscriptions.v_billing_signals to nabvy_pipeline;
