-- The 24-hour deletion purge (services/account/src/index.ts, purgeDueDeletions): erases every row
-- this module holds for a user whose deletion_requests.purge_by is due, including the
-- deletion_requests row itself (its removal is the function's own idempotency marker: nothing left
-- to purge on a repeat run). nabvy_pipeline already has delete on user_profiles, telegram_links and
-- push_subscriptions (20260924155222_account_access.sql); this fills the four tables that migration
-- gave it only select/update (or select) on.
select nabvy_core.allow_pipeline('account.telegram_link_codes', 'delete');
grant delete on account.telegram_link_codes to nabvy_pipeline;

select nabvy_core.allow_pipeline('account.deletion_requests', 'delete');
grant delete on account.deletion_requests to nabvy_pipeline;

select nabvy_core.allow_pipeline('account.api_keys', 'delete');
grant delete on account.api_keys to nabvy_pipeline;

select nabvy_core.allow_pipeline('account.standing', 'delete');
grant delete on account.standing to nabvy_pipeline;
