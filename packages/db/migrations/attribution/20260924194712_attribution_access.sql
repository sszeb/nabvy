-- attribution: grants, RLS, the append-only guard on partner_events and the internal view.
-- Hand-written (packages/db/README.md).
--
-- Invariants (services/attribution/README.md, "Tables"):
--   * sign-up capture and partner calls run in the pipeline (no user session exists at sign-up
--     for a hook-driven write, the same reason account.confirmTelegramLink runs in withPipeline);
--     nabvy_app only ever reads its own rows, for the account page's referral code;
--   * partner_events rows are never edited or truncated; the pipeline may delete a user's rows
--     only for the account-deletion purge, the same pattern as usage_ledger.entries;
--   * a self-referral is refused by a check constraint, not just in application code.
comment on schema attribution is
  'Attribution: UTM tags, Dub partner links and customer referral codes. Owner: the attribution module.';
grant usage on schema attribution to nabvy_app, nabvy_pipeline;

-- utm_attributions: written once at sign-up by the pipeline; the app reads its own row only
-- (the account page shows whether a partner link or referral code was captured, never another
-- user's).
grant select on attribution.utm_attributions to nabvy_app;
select nabvy_core.enable_user_rls('attribution.utm_attributions');
select nabvy_core.allow_pipeline('attribution.utm_attributions', 'select');
select nabvy_core.allow_pipeline('attribution.utm_attributions', 'insert');
select nabvy_core.allow_pipeline('attribution.utm_attributions', 'update');
select nabvy_core.allow_pipeline('attribution.utm_attributions', 'delete');
grant select, insert, update, delete on attribution.utm_attributions to nabvy_pipeline;
select nabvy_core.track_updated_at('attribution.utm_attributions');

-- referral_codes: the app reads its own code (the account page and the share link); only the
-- pipeline issues one, once, at sign-up capture, and deletes it for the account-deletion purge.
grant select on attribution.referral_codes to nabvy_app;
select nabvy_core.enable_user_rls('attribution.referral_codes');
select nabvy_core.allow_pipeline('attribution.referral_codes', 'select');
select nabvy_core.allow_pipeline('attribution.referral_codes', 'insert');
select nabvy_core.allow_pipeline('attribution.referral_codes', 'delete');
grant select, insert, delete on attribution.referral_codes to nabvy_pipeline;

-- referrals: pipeline only (no nabvy_app grant at all: not shown to either side yet). RLS is
-- enabled defensively, as usage_ledger.buckets does for a pipeline-only table, even though the
-- self-referral check constraint holds regardless of who writes.
select nabvy_core.allow_pipeline('attribution.referrals', 'select');
select nabvy_core.allow_pipeline('attribution.referrals', 'insert');
select nabvy_core.allow_pipeline('attribution.referrals', 'update');
select nabvy_core.allow_pipeline('attribution.referrals', 'delete');
grant select, insert, update, delete on attribution.referrals to nabvy_pipeline;

-- partner_events: no role may update it (the same pattern as subscriptions.billing_events), but
-- the pipeline may delete, for the account-deletion purge only (the pattern usage_ledger.entries
-- uses: "no role may update them; only the pipeline may delete them, for the account-deletion
-- purge").
select nabvy_core.allow_pipeline('attribution.partner_events', 'select');
select nabvy_core.allow_pipeline('attribution.partner_events', 'insert');
select nabvy_core.allow_pipeline('attribution.partner_events', 'delete');
grant select, insert, delete on attribution.partner_events to nabvy_pipeline;
create or replace function attribution.refuse_partner_event_change() returns trigger
language plpgsql security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'attribution: partner_events rows are never edited' using errcode = '42501';
end;
$$;
revoke all on function attribution.refuse_partner_event_change() from public;
create trigger partner_events_append_only before update on attribution.partner_events
  for each row execute function attribution.refuse_partner_event_change();
create trigger partner_events_no_truncate before truncate on attribution.partner_events
  for each statement execute function attribution.refuse_partner_event_change();

-- Internal view (rule 5): one row per captured user. Never seller data. Readers: nabvy_pipeline
-- only until per-module roles exist (lifecycle-messaging, search-planner). Rows only while the
-- module is not off (rule 11); a captured user always has a referral_codes row (both are written
-- in the same transaction), so the join is inner.
create view attribution.v_attributions with (security_invoker = true) as
  select
    u.user_id,
    u.utm_source,
    u.utm_medium,
    u.utm_campaign,
    u.utm_content,
    u.utm_term,
    u.affiliate_click_id,
    u.affiliate_code,
    u.affiliate_partner_id,
    c.code as referral_code,
    r.referrer_user_id as referred_by,
    r.referred_at,
    r.credited_at,
    u.created_at as captured_at
  from attribution.utm_attributions as u
  join attribution.referral_codes as c on c.user_id = u.user_id
  left join attribution.referrals as r on r.referred_user_id = u.user_id
  where switches.state('attribution') <> 'off';
revoke all on attribution.v_attributions from public;
grant select on attribution.v_attributions to nabvy_pipeline;
