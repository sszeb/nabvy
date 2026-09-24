-- account: grants, RLS, internal views. Hand-written (packages/db/README.md).
comment on schema account is
  'Account: profile, Telegram links, push subscriptions, deletion requests, API keys and standing. Owner: the account module.';
grant usage on schema account to nabvy_app, nabvy_pipeline;

-- user_profiles: the user's own row. The user writes it directly through withUser; the pipeline
-- reads it for other modules' internal views (v_profiles) and for the deletion purge job.
grant select, insert, update, delete on account.user_profiles to nabvy_app;
select nabvy_core.enable_user_rls('account.user_profiles');
select nabvy_core.allow_pipeline('account.user_profiles', 'select');
select nabvy_core.allow_pipeline('account.user_profiles', 'delete');
grant select, delete on account.user_profiles to nabvy_pipeline;
select nabvy_core.track_updated_at('account.user_profiles');

-- telegram_links: the user unlinks their own row; the Telegram bot's link callback confirms a
-- link with no user session, so that write runs as the pipeline (services/account/README.md,
-- "Telegram and push binding"). One chat per user (primary key) and one user per chat (the
-- partial unique index on the schema file) hold together whichever role writes.
grant select, insert, update, delete on account.telegram_links to nabvy_app;
select nabvy_core.enable_user_rls('account.telegram_links');
select nabvy_core.allow_pipeline('account.telegram_links', 'select');
select nabvy_core.allow_pipeline('account.telegram_links', 'insert');
select nabvy_core.allow_pipeline('account.telegram_links', 'update');
select nabvy_core.allow_pipeline('account.telegram_links', 'delete');
grant select, insert, update, delete on account.telegram_links to nabvy_pipeline;

-- telegram_link_codes: the user requests a code; the bot callback marks it used. Never updated by
-- the user, so nabvy_app gets no update grant.
grant select, insert on account.telegram_link_codes to nabvy_app;
select nabvy_core.enable_user_rls('account.telegram_link_codes');
select nabvy_core.allow_pipeline('account.telegram_link_codes', 'select');
select nabvy_core.allow_pipeline('account.telegram_link_codes', 'update');
grant select, update on account.telegram_link_codes to nabvy_pipeline;

-- push_subscriptions: subscribe and unsubscribe are both the user's own action.
grant select, insert, update, delete on account.push_subscriptions to nabvy_app;
select nabvy_core.enable_user_rls('account.push_subscriptions');
select nabvy_core.allow_pipeline('account.push_subscriptions', 'select');
select nabvy_core.allow_pipeline('account.push_subscriptions', 'delete');
grant select, delete on account.push_subscriptions to nabvy_pipeline;
select nabvy_core.track_updated_at('account.push_subscriptions');

-- deletion_requests: the user files their own request; the 24-hour purge sweep (pipeline) reads
-- what is due and marks it purged.
grant select, insert on account.deletion_requests to nabvy_app;
select nabvy_core.enable_user_rls('account.deletion_requests');
select nabvy_core.allow_pipeline('account.deletion_requests', 'select');
select nabvy_core.allow_pipeline('account.deletion_requests', 'update');
grant select, update on account.deletion_requests to nabvy_pipeline;

-- api_keys: scaffolded for 5.4a (after the MVP); the user manages their own keys.
grant select, insert, update, delete on account.api_keys to nabvy_app;
select nabvy_core.enable_user_rls('account.api_keys');
select nabvy_core.allow_pipeline('account.api_keys', 'select');
grant select on account.api_keys to nabvy_pipeline;

-- standing: written only by setStanding(), called only by account-integrity (automated) or an
-- audited admin override, both running inside withPipeline (the same convention questions.md
-- records for switches: no admin check exists yet for nabvy_app, so a signed-in session can never
-- flip a switch, or here, an account's standing, directly). No delete: a standing row changes, it
-- is never removed. isActive() never reads this table; it calls @nabvy/auth's isAccountActive,
-- which reads better_auth.user directly (services/account/README.md, "Standing").
select nabvy_core.allow_pipeline('account.standing', 'select');
select nabvy_core.allow_pipeline('account.standing', 'insert');
select nabvy_core.allow_pipeline('account.standing', 'update');
grant select, insert, update on account.standing to nabvy_pipeline;

-- Internal views (rule 5 of docs/design/modules/_rules.md): security_invoker so RLS applies to
-- the caller. Granted to nabvy_pipeline only until per-module roles exist (packages/db/README.md,
-- "One Postgres schema per module"; the same stand-in switches and audit-log use).
create view account.v_profiles with (security_invoker = true) as
  select user_id, display_name, analytics_consent, design_partner, created_at
  from account.user_profiles;
revoke all on account.v_profiles from public;
grant select on account.v_profiles to nabvy_pipeline;

-- v_channels: one row per active or revoked binding, Telegram and push together, for
-- account-integrity's checkChannelBinding(). Exempt from the switch filter (rule 11): this view
-- carries no `switches.is_on('account')` filter, so it always returns its rows.
create view account.v_channels with (security_invoker = true) as
  select user_id, 'telegram' as kind, null::text as device_id, null::text as session_id,
         linked_at as bound_at, revoked_at
  from account.telegram_links
  union all
  select user_id, 'push' as kind, device_id, session_id, created_at as bound_at, revoked_at
  from account.push_subscriptions;
revoke all on account.v_channels from public;
grant select on account.v_channels to nabvy_pipeline;

-- v_standing: status, until and fair-use limits only (no action_id: that is this module's own
-- audit trail, never another module's business). Exempt from the switch filter (rule 11).
create view account.v_standing with (security_invoker = true) as
  select user_id, status, until, limits from account.standing;
revoke all on account.v_standing from public;
grant select on account.v_standing to nabvy_pipeline;
