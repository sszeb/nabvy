-- Access for the rate-limit table and the restriction policy (task 4.0, review of PR #9).
-- Hand-written (drizzle-kit --custom).

-- Better Auth's rate-limit counters, shared by every server instance (services/auth/README.md,
-- "Rate limits"). Only Better Auth's own role uses them.
grant select, insert, update, delete on better_auth.rate_limit to nabvy_auth;

-- The policy a restriction was taken under: the only thing a restricted user is told
-- (docs/decisions.md, "Fair use, suspension and bans"). Null while the account is not restricted.
alter table better_auth."user"
  add constraint user_restriction_policy_check
  check (restriction_policy in ('terms', 'acceptable-use', 'fair-use'));

-- The notice's two facts for a restricted account, for jobs that refuse to act for it: the step
-- ('suspended' or 'banned') and the policy (unset counts as the Terms of Service). No row when the
-- account is active or unknown. Nothing else: no reason, no expiry.
create or replace function better_auth.account_restriction(target uuid)
returns table (step text, policy text)
language sql stable security definer
set search_path = pg_catalog
set timezone = 'UTC'
as $$
  select case when u.ban_expires is null then 'banned' else 'suspended' end,
         coalesce(u.restriction_policy, 'terms')
  from better_auth."user" as u
  where u.id = target
    and coalesce(u.banned, false)
    and (u.ban_expires is null or u.ban_expires > localtimestamp)
$$;
revoke all on function better_auth.account_restriction(uuid) from public;
grant execute on function better_auth.account_restriction(uuid) to nabvy_app, nabvy_pipeline, nabvy_auth;
