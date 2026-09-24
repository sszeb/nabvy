-- The role the running Better Auth instance connects as (task 4.0; services/auth/README.md,
-- "Database role"). Hand-written (drizzle-kit --custom).
--
-- Better Auth reads sessions, accounts and verification rows before any user is known, so these
-- tables cannot sit behind the withUser policy. Rather than grant nabvy_app the whole of
-- better_auth (every web request's role could then read every session token and OAuth token),
-- Better Auth gets its own role, nabvy_auth, which can reach these four tables and nothing else.
-- Like the other roles it is created NOLOGIN; the coordinator enables login and sets its password
-- on the live project out of band, and fills DATABASE_URL_AUTH (docs/secrets.md). It connects
-- through Supabase's transaction pooler like the others: Better Auth keeps no session state.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'nabvy_auth') then
    create role nabvy_auth nologin nobypassrls noinherit;
  end if;
end;
$$;
comment on role nabvy_auth is
  'Nabvy auth module (Better Auth). Reads and writes better_auth user, session, account and verification only.';
alter role nabvy_auth set search_path = better_auth;

grant usage on schema better_auth to nabvy_auth;
grant select, insert, update, delete
  on better_auth."user", better_auth.session, better_auth.account, better_auth.verification
  to nabvy_auth;
-- better_auth.subscription belongs to the Stripe plugin, which the billing module switches on;
-- it adds its own grant then.

-- Account standing (docs/decisions.md, "Fair use, suspension and bans"): every job that acts for
-- a user refuses a suspended or banned account. Jobs run as nabvy_app or nabvy_pipeline, which
-- cannot read better_auth, so they ask this function. It answers one boolean and nothing else:
-- no reason, no expiry. A ban with an expiry in the past no longer restricts (Better Auth's own
-- rule); an unknown user is not active. Better Auth writes UTC wall-clock timestamps.
create or replace function better_auth.account_active(target uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog
set timezone = 'UTC'
as $$
  select coalesce(
    (
      select not (coalesce(u.banned, false) and (u.ban_expires is null or u.ban_expires > localtimestamp))
      from better_auth."user" as u
      where u.id = target
    ),
    false
  )
$$;
revoke all on function better_auth.account_active(uuid) from public;
grant usage on schema better_auth to nabvy_app, nabvy_pipeline;
grant execute on function better_auth.account_active(uuid) to nabvy_app, nabvy_pipeline, nabvy_auth;
